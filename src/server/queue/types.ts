/** Provider-agnostic job queue. Dev uses a DB-backed table; prod can swap in Redis/BullMQ. */

export interface EnqueueOptions {
  runAt?: Date;
  maxAttempts?: number;
}

export interface QueuedJob {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
}

export type JobHandler = (job: QueuedJob) => Promise<void>;

export interface Queue {
  readonly id: string;
  enqueue(type: string, payload: unknown, opts?: EnqueueOptions): Promise<string>;
}
