import { getEnv } from "../../lib/env";
import { DbQueue } from "./db";
import type { Queue } from "./types";

let cached: Queue | null = null;

export function getQueue(): Queue {
  if (cached) return cached;
  const env = getEnv();
  switch (env.QUEUE_PROVIDER) {
    case "db":
      cached = new DbQueue();
      return cached;
    case "redis":
      throw new Error(`QUEUE_PROVIDER="redis" is not wired yet. Set QUEUE_PROVIDER=db for now.`);
    default:
      throw new Error(`Unknown QUEUE_PROVIDER: ${env.QUEUE_PROVIDER as string}`);
  }
}

export type { Queue, JobHandler, QueuedJob, EnqueueOptions } from "./types";
