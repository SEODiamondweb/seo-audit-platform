/**
 * BullMQ worker: executes Screaming Frog crawl jobs end-to-end.
 *
 *   queue → run SF CLI (headless) → locate exports → ingest CSVs
 *         → process audit (issues + score) → mark job/audit READY
 *
 * If Screaming Frog is not available the job fails fast with a clear message;
 * crawls are never simulated.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { Worker } from "bullmq";
import { getRedisConnection } from "../lib/redis";
import { CRAWL_QUEUE_NAME, type CrawlJobData } from "../lib/queue/crawlQueue";
import { prisma } from "../lib/prisma";
import { screamingFrog, ScreamingFrogError } from "../lib/screamingfrog/provider";
import { crawlConfigSchema } from "../lib/screamingfrog/config";
import { ingestFiles } from "../lib/import/ingest";
import { processAudit } from "../lib/audit/persist";

async function setJob(jobId: string, data: Record<string, unknown>) {
  await prisma.screamingFrogJob.update({ where: { id: jobId }, data });
}

async function handle(data: CrawlJobData) {
  const { jobId, auditId, domain } = data;
  const record = await prisma.screamingFrogJob.findUniqueOrThrow({ where: { id: jobId } });
  const config = crawlConfigSchema.parse(record.config ?? {});

  await setJob(jobId, { status: "RUNNING", startedAt: new Date(), progress: 5, message: "Avvio crawl" });
  await prisma.audit.update({ where: { id: auditId }, data: { status: "PROCESSING" } });

  const result = await screamingFrog.run(
    { jobId, domain, config },
    {
      onStatus: async (status, progress, message) => {
        await setJob(jobId, {
          ...(status ? { status: status as any } : {}),
          ...(progress != null ? { progress } : {}),
          ...(message ? { message } : {}),
        }).catch(() => {});
      },
    },
  );

  // Ingest exported CSVs.
  await setJob(jobId, { status: "IMPORTING", progress: 85, message: "Import export", exportPath: result.outputDir });
  const files = await Promise.all(
    result.exportedFiles.map(async (p) => ({ name: basename(p), buffer: await readFile(p) })),
  );
  const ingest = await ingestFiles({ files });
  if (ingest.urls.length === 0) {
    throw new ScreamingFrogError("Export presenti ma nessuna URL elaborabile.", "NO_EXPORTS");
  }

  await processAudit(auditId, ingest.urls as any);
  await setJob(jobId, { status: "COMPLETED", progress: 100, finishedAt: new Date(), message: `${ingest.urls.length} URL importate` });
}

const worker = new Worker<CrawlJobData>(
  CRAWL_QUEUE_NAME,
  async (job) => handle(job.data),
  { connection: getRedisConnection(), concurrency: 1 },
);

worker.on("failed", async (job, err) => {
  if (!job) return;
  const kind = err instanceof ScreamingFrogError ? err.kind : "PROCESS_FAILED";
  const status = kind === "TIMEOUT" ? "TIMEOUT" : "FAILED";
  await prisma.screamingFrogJob
    .update({ where: { id: job.data.jobId }, data: { status: status as any, errorMessage: err.message, finishedAt: new Date() } })
    .catch(() => {});
  await prisma.audit
    .update({ where: { id: job.data.auditId }, data: { status: "FAILED" } })
    .catch(() => {});
  console.error(`[worker] job ${job.id} failed: ${err.message}`);
});

worker.on("completed", (job) => console.log(`[worker] job ${job.id} completed`));

console.log(`[worker] listening on "${CRAWL_QUEUE_NAME}" — SF available: ${screamingFrog.isAvailable()}`);
