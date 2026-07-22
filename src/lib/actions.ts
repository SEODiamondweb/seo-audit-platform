"use server";

import { Buffer } from "node:buffer";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import { currentOrg } from "./data";
import { env } from "./env";
import { ingestFiles } from "./import/ingest";
import { processAudit } from "./audit/persist";
import { crawlConfigSchema } from "./screamingfrog/config";
import { screamingFrog } from "./screamingfrog/provider";
import { enqueueCrawl } from "./queue/crawlQueue";

// --- Clients & projects ------------------------------------------------------
export async function createClient(formData: FormData) {
  const org = await currentOrg();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await prisma.client.create({
    data: {
      organizationId: org.id,
      name,
      contactEmail: String(formData.get("contactEmail") ?? "") || null,
      notes: String(formData.get("notes") ?? "") || null,
    },
  });
  revalidatePath("/clients");
}

export async function createProject(formData: FormData) {
  const clientId = String(formData.get("clientId"));
  const name = String(formData.get("name") ?? "").trim();
  const domain = String(formData.get("domain") ?? "").trim();
  if (!clientId || !name || !domain) return;
  await prisma.project.create({ data: { clientId, name, domain } });
  revalidatePath(`/clients/${clientId}`);
}

// --- Manual import -----------------------------------------------------------
export async function importAudit(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const label = String(formData.get("label") ?? "").trim() || `Import ${new Date().toISOString().slice(0, 10)}`;
  const auditDate = String(formData.get("auditDate") ?? "");

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return;

  const audit = await prisma.audit.create({
    data: {
      projectId,
      label,
      source: "MANUAL_IMPORT",
      status: "PROCESSING",
      auditDate: auditDate ? new Date(auditDate) : new Date(),
      config: { domain: project.domain, files: files.map((f) => f.name) },
    },
  });

  const stored: { name: string; buffer: Buffer }[] = [];
  const dir = join(env.UPLOAD_DIR, audit.id);
  await mkdir(dir, { recursive: true });
  for (const f of files) {
    const buffer = Buffer.from(await f.arrayBuffer());
    await writeFile(join(dir, f.name), buffer).catch(() => {});
    stored.push({ name: f.name, buffer });
  }

  const importedFile = await prisma.importedFile.create({
    data: {
      auditId: audit.id,
      originalName: files.map((f) => f.name).join(", "),
      storedPath: dir,
      status: "PARSING",
      sizeBytes: files.reduce((s, f) => s + f.size, 0),
    },
  });

  try {
    const result = await ingestFiles({ files: stored });
    if (result.urls.length === 0) {
      await prisma.importedFile.update({
        where: { id: importedFile.id },
        data: { status: "FAILED", errorMessage: result.warnings.join("; ") || "Nessuna URL valida", unknownColumns: result.unknownColumns },
      });
      await prisma.audit.update({ where: { id: audit.id }, data: { status: "FAILED" } });
      revalidatePath(`/projects/${projectId}`);
      return;
    }
    await processAudit(audit.id, result.urls as any);
    await prisma.importedFile.update({
      where: { id: importedFile.id },
      data: {
        status: result.warnings.length ? "PARTIAL" : "IMPORTED",
        rowsTotal: result.rowsTotal,
        rowsImported: result.rowsImported,
        rowsSkipped: result.rowsSkipped,
        unknownColumns: result.unknownColumns,
        errorMessage: result.warnings.join("; ") || null,
      },
    });
  } catch (err) {
    await prisma.importedFile.update({
      where: { id: importedFile.id },
      data: { status: "FAILED", errorMessage: err instanceof Error ? err.message : String(err) },
    });
    await prisma.audit.update({ where: { id: audit.id }, data: { status: "FAILED" } });
  }

  revalidatePath(`/projects/${projectId}`);
  redirect(`/audits/${audit.id}`);
}

// --- Automatic scan (Screaming Frog CLI) ------------------------------------
export async function startScan(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });

  if (!screamingFrog.isAvailable()) {
    // Guard: never simulate. Surface manual-import-only mode.
    throw new Error("Screaming Frog non configurato: disponibile solo l'import manuale.");
  }

  const config = crawlConfigSchema.parse({
    maxUrls: formData.get("maxUrls") || undefined,
    maxDepth: formData.get("maxDepth") || undefined,
    respectRobots: formData.get("respectRobots") === "on",
    crawlSubdomains: formData.get("crawlSubdomains") === "on",
    jsRendering: formData.get("jsRendering") === "on",
    userAgent: formData.get("userAgent") || undefined,
    maxUrlsPerSecond: formData.get("maxUrlsPerSecond") || undefined,
  });

  const audit = await prisma.audit.create({
    data: { projectId, label: String(formData.get("label") || "Scansione") , source: "SCREAMING_FROG_CLI", status: "PROCESSING", config: config as any },
  });
  const job = await prisma.screamingFrogJob.create({
    data: { projectId, auditId: audit.id, domain: project.domain, config: config as any, status: "QUEUED" },
  });
  const bullJobId = await enqueueCrawl({ jobId: job.id, auditId: audit.id, domain: project.domain });
  await prisma.screamingFrogJob.update({ where: { id: job.id }, data: { bullJobId } });

  revalidatePath(`/projects/${projectId}`);
  redirect(`/projects/${projectId}`);
}

// --- Issues ------------------------------------------------------------------
export async function updateIssue(formData: FormData) {
  const id = String(formData.get("id"));
  const data: Record<string, unknown> = {};
  const status = formData.get("status");
  const assigneeId = formData.get("assigneeId");
  const priority = formData.get("priority");
  if (status) data.status = status;
  if (priority) data.priority = priority;
  if (assigneeId !== null) data.assigneeId = assigneeId === "" ? null : String(assigneeId);
  const issue = await prisma.auditIssue.update({ where: { id }, data });
  revalidatePath(`/issues/${id}`);
  revalidatePath(`/audits/${issue.auditId}`);
}

// --- Tasks -------------------------------------------------------------------
export async function createTask(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const title = String(formData.get("title") ?? "").trim();
  if (!projectId || !title) return;
  await prisma.task.create({
    data: {
      projectId,
      title,
      description: String(formData.get("description") ?? "") || null,
      issueId: String(formData.get("issueId") ?? "") || null,
      priority: (String(formData.get("priority") || "P2") as any),
      assigneeId: String(formData.get("assigneeId") ?? "") || null,
    },
  });
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/tasks");
}

export async function updateTask(formData: FormData) {
  const id = String(formData.get("id"));
  const status = String(formData.get("status") || "");
  const task = await prisma.task.update({ where: { id }, data: status ? { status: status as any } : {} });
  revalidatePath("/tasks");
  revalidatePath(`/projects/${task.projectId}`);
}

// --- Reports -----------------------------------------------------------------
export async function createReport(formData: FormData) {
  const auditId = String(formData.get("auditId"));
  const format = String(formData.get("format") || "HTML");
  await prisma.report.create({
    data: { auditId, title: `Report ${new Date().toISOString().slice(0, 10)}`, format: format as any },
  });
  revalidatePath(`/audits/${auditId}/report`);
}
