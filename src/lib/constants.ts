import { z } from "zod";

/**
 * Canonical string-union values. SQLite has no native enums, so these live in
 * app code and are validated with zod. They map 1:1 to the String columns in
 * prisma/schema.prisma.
 */

export const ROLES = ["owner", "member", "viewer"] as const;
export const roleSchema = z.enum(ROLES);
export type Role = (typeof ROLES)[number];

export const SOURCE_TYPES = ["zip", "github"] as const;
export const sourceTypeSchema = z.enum(SOURCE_TYPES);
export type SourceType = (typeof SOURCE_TYPES)[number];

export const RUN_STATUSES = [
  "queued",
  "analyzing",
  "planning",
  "modifying",
  "validating",
  "repairing",
  "passed",
  "failed",
  "delivered",
  "canceled",
] as const;
export const runStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_PHASES = ["analyze", "plan", "modify", "validate", "repair", "deliver"] as const;
export const runPhaseSchema = z.enum(RUN_PHASES);
export type RunPhase = (typeof RUN_PHASES)[number];

export const INPUT_TYPES = [
  "text",
  "color",
  "url",
  "file",
  "image",
  "csv",
  "boolean",
  "select",
] as const;
export const inputTypeSchema = z.enum(INPUT_TYPES);
export type InputType = (typeof INPUT_TYPES)[number];

export const QA_CHECK_TYPES = [
  "build",
  "typescript",
  "lint",
  "api",
  "e2e",
  "visual",
  "branding",
] as const;
export const qaCheckTypeSchema = z.enum(QA_CHECK_TYPES);
export type QaCheckType = (typeof QA_CHECK_TYPES)[number];

export const QA_STATUSES = ["pass", "fail", "skip"] as const;
export const qaStatusSchema = z.enum(QA_STATUSES);
export type QaStatus = (typeof QA_STATUSES)[number];

export const JOB_STATUSES = ["pending", "active", "completed", "failed"] as const;
export const jobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = (typeof JOB_STATUSES)[number];
