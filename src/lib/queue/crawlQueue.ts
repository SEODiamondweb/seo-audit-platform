import { Queue } from "bullmq";
import { getRedisConnection } from "../redis";

export const CRAWL_QUEUE_NAME = "sf-crawl";

export interface CrawlJobData {
  jobId: string; // ScreamingFrogJob.id
  auditId: string;
  domain: string;
}

let queue: Queue<CrawlJobData> | null = null;

export function getCrawlQueue(): Queue<CrawlJobData> {
  if (!queue) {
    queue = new Queue<CrawlJobData>(CRAWL_QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 1, // crawls are expensive; do not blindly retry
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
  }
  return queue;
}

export async function enqueueCrawl(data: CrawlJobData): Promise<string> {
  const job = await getCrawlQueue().add("crawl", data, { jobId: data.jobId });
  return job.id ?? data.jobId;
}
