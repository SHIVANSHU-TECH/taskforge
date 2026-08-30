import "dotenv/config";
import { runDbWorker } from "../src/server/queue/db";
import type { JobHandler } from "../src/server/queue/types";
import { RUN_JOB_TYPE, runJobHandler } from "../src/server/execution";

/**
 * TaskForge worker process. Long-running; consumes the DB-backed queue.
 * QA / delivery handlers are registered here in later phases.
 */
const handlers: Record<string, JobHandler> = {
  echo: async (job) => {
    console.log(`[worker] echo job ${job.id}:`, JSON.stringify(job.payload));
  },
  [RUN_JOB_TYPE]: runJobHandler,
};

async function main(): Promise<void> {
  const controller = new AbortController();
  const shutdown = () => {
    console.log("[worker] shutdown signal received");
    controller.abort();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log(`[worker] started (pid ${process.pid}). Polling for jobs…`);
  await runDbWorker(handlers, { workerId: `worker-${process.pid}`, signal: controller.signal });
  console.log("[worker] stopped.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
