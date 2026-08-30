import { z } from "zod";
import type { JobHandler } from "../queue/types";
import { executeRun } from "./engine";

export const RUN_JOB_TYPE = "run";

const runPayloadSchema = z.object({ runId: z.string().min(1) });

/** Queue handler for `run` jobs. Registered by the worker (and the dev drainer). */
export const runJobHandler: JobHandler = async (job) => {
  const parsed = runPayloadSchema.safeParse(job.payload);
  if (!parsed.success) throw new Error(`Invalid run job payload: ${job.id}`);
  await executeRun(parsed.data.runId);
};

export { executeRun } from "./engine";
