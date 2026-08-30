import { prisma } from "../../lib/db";
import type { EnqueueOptions, JobHandler, Queue, QueuedJob } from "./types";

export class DbQueue implements Queue {
  readonly id = "db";

  async enqueue(type: string, payload: unknown, opts?: EnqueueOptions): Promise<string> {
    const job = await prisma.job.create({
      data: {
        type,
        payloadJson: JSON.stringify(payload ?? {}),
        runAt: opts?.runAt ?? new Date(),
        maxAttempts: opts?.maxAttempts ?? 3,
      },
    });
    return job.id;
  }
}

export interface WorkerOptions {
  workerId: string;
  pollIntervalMs?: number;
  signal?: AbortSignal;
}

/**
 * Poll loop for the DB-backed queue. Claims one pending job at a time, runs its
 * handler, and marks it completed or (with backoff) retryable/failed.
 */
export async function runDbWorker(
  handlers: Record<string, JobHandler>,
  opts: WorkerOptions,
): Promise<void> {
  const poll = opts.pollIntervalMs ?? 1000;

  while (!opts.signal?.aborted) {
    const claimed = await claimNext(opts.workerId);
    if (!claimed) {
      await sleep(poll, opts.signal);
      continue;
    }

    const job: QueuedJob = {
      id: claimed.id,
      type: claimed.type,
      payload: safeParse(claimed.payloadJson),
      attempts: claimed.attempts,
    };

    try {
      const handler = handlers[claimed.type];
      if (!handler) throw new Error(`No handler registered for job type "${claimed.type}"`);
      await handler(job);
      await prisma.job.update({
        where: { id: claimed.id },
        data: { status: "completed", lockedAt: null, lockedBy: null, lastError: null },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const exhausted = claimed.attempts >= claimed.maxAttempts;
      await prisma.job.update({
        where: { id: claimed.id },
        data: {
          status: exhausted ? "failed" : "pending",
          lastError: message,
          lockedAt: null,
          lockedBy: null,
          runAt: exhausted ? claimed.runAt : new Date(Date.now() + 2000 * claimed.attempts),
        },
      });
    }
  }
}

/**
 * Process currently-pending jobs in a single pass (no long-running loop) and
 * return how many ran. Used by the dev-only queue drainer so runs can be
 * advanced from the web app without a separate worker process. In production
 * the long-running `runDbWorker` does this continuously.
 */
export async function drainOnce(
  handlers: Record<string, JobHandler>,
  workerId: string,
  max = 25,
): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;

  for (let i = 0; i < max; i++) {
    const claimed = await claimNext(workerId);
    if (!claimed) break;

    const job: QueuedJob = {
      id: claimed.id,
      type: claimed.type,
      payload: safeParse(claimed.payloadJson),
      attempts: claimed.attempts,
    };

    try {
      const handler = handlers[claimed.type];
      if (!handler) throw new Error(`No handler registered for job type "${claimed.type}"`);
      await handler(job);
      await prisma.job.update({
        where: { id: claimed.id },
        data: { status: "completed", lockedAt: null, lockedBy: null, lastError: null },
      });
      processed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed++;
      await prisma.job.update({
        where: { id: claimed.id },
        data: { status: "failed", lastError: message, lockedAt: null, lockedBy: null },
      });
    }
  }

  return { processed, failed };
}

/**
 * A job claimed by a dead/hung worker keeps `status: "active"` forever. Before
 * picking new work, reclaim any active job whose lock is older than this.
 */
const VISIBILITY_TIMEOUT_MS = 5 * 60_000;

/** Return `active` jobs whose lock has expired to the pool (or fail them if exhausted). */
async function reapStaleJobs(): Promise<void> {
  const cutoff = new Date(Date.now() - VISIBILITY_TIMEOUT_MS);
  const stale = await prisma.job.findMany({
    where: { status: "active", lockedAt: { lt: cutoff } },
    select: { id: true, attempts: true, maxAttempts: true },
  });
  for (const job of stale) {
    const exhausted = job.attempts >= job.maxAttempts;
    // Guard on the id + status so we don't clobber a job a live worker just finished.
    await prisma.job.updateMany({
      where: { id: job.id, status: "active", lockedAt: { lt: cutoff } },
      data: {
        status: exhausted ? "failed" : "pending",
        lockedAt: null,
        lockedBy: null,
        lastError: exhausted
          ? "Worker lock expired and max attempts reached"
          : "Reclaimed after worker lock expired",
        runAt: exhausted ? undefined : new Date(),
      },
    });
  }
}

async function claimNext(workerId: string) {
  await reapStaleJobs();

  const candidate = await prisma.job.findFirst({
    where: { status: "pending", runAt: { lte: new Date() } },
    orderBy: { runAt: "asc" },
  });
  if (!candidate) return null;

  // Guard on status to avoid a double-claim race. attempts is incremented on claim.
  const res = await prisma.job.updateMany({
    where: { id: candidate.id, status: "pending" },
    data: {
      status: "active",
      lockedAt: new Date(),
      lockedBy: workerId,
      attempts: { increment: 1 },
    },
  });
  if (res.count === 0) return null;

  return prisma.job.findUnique({ where: { id: candidate.id } });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
