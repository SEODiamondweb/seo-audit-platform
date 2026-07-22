import IORedis from "ioredis";
import { env } from "./env";

/**
 * Shared Redis connection factory for BullMQ.
 * BullMQ requires `maxRetriesPerRequest: null` on its connections.
 */
export function createRedisConnection(): IORedis {
  return new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

let sharedConnection: IORedis | null = null;

export function getRedisConnection(): IORedis {
  if (!sharedConnection) sharedConnection = createRedisConnection();
  return sharedConnection;
}
