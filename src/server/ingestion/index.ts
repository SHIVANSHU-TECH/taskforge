import { prisma } from "../../lib/db";
import { getStorageProvider } from "../storage";
import { analyzeProject } from "./analyze";
import { extractZip } from "./extract";
import { fetchGithubArchive, parseGithubUrl } from "./github";
import type { AnalyzerResult } from "./types";

function analysisData(a: AnalyzerResult) {
  return {
    framework: a.framework,
    packageManager: a.packageManager,
    nodeVersion: a.nodeVersion,
    scriptsJson: JSON.stringify(a.scripts),
    entryPointsJson: JSON.stringify(a.entryPoints),
    envVarsDetectedJson: JSON.stringify(a.envVars),
    dependenciesJson: JSON.stringify(a.dependencies),
    fileTreeJson: JSON.stringify(a.fileTree),
    fileCount: a.fileCount,
    sizeBytes: a.sizeBytes,
  };
}

interface IngestArchiveArgs {
  workspaceId: string;
  name: string;
  sourceType: "zip" | "github";
  sourceRef?: string;
  zipBuffer: Buffer;
}

/**
 * Core ingestion path shared by ZIP upload and GitHub import:
 * validate + extract → analyze → create Project → store raw archive → persist analysis.
 * Validation runs before any DB write; if a later step fails the Project row is rolled back.
 */
export async function ingestArchive(args: IngestArchiveArgs): Promise<{ projectId: string }> {
  // Throws on unsafe/oversized/invalid archives — before we touch the DB.
  const extracted = extractZip(args.zipBuffer);
  const analysis = analyzeProject(extracted);

  const project = await prisma.project.create({
    data: {
      workspaceId: args.workspaceId,
      name: args.name,
      sourceType: args.sourceType,
      sourceRef: args.sourceRef ?? null,
    },
  });

  try {
    const storage = getStorageProvider();
    const key = `projects/${project.id}/source.zip`;
    await storage.put(key, args.zipBuffer, { contentType: "application/zip" });

    await prisma.project.update({ where: { id: project.id }, data: { storageKey: key } });
    await prisma.projectAnalysis.create({
      data: { projectId: project.id, ...analysisData(analysis) },
    });
  } catch (err) {
    await prisma.project.delete({ where: { id: project.id } }).catch(() => {});
    throw err;
  }

  return { projectId: project.id };
}

/** Ingest an uploaded ZIP file. `name` defaults to a cleaned version of the filename. */
export async function ingestZipUpload(args: {
  workspaceId: string;
  filename: string;
  zipBuffer: Buffer;
}): Promise<{ projectId: string }> {
  const name = args.filename.replace(/\.zip$/i, "").trim() || "Uploaded project";
  return ingestArchive({
    workspaceId: args.workspaceId,
    name,
    sourceType: "zip",
    sourceRef: args.filename,
    zipBuffer: args.zipBuffer,
  });
}

/** Ingest a GitHub repository by URL / shorthand. */
export async function ingestGithubRepo(args: {
  workspaceId: string;
  url: string;
}): Promise<{ projectId: string }> {
  const parsed = parseGithubUrl(args.url);
  const { buffer, resolvedRef } = await fetchGithubArchive(parsed);
  const sourceRef = `${parsed.owner}/${parsed.repo}${resolvedRef ? `@${resolvedRef}` : ""}`;
  return ingestArchive({
    workspaceId: args.workspaceId,
    name: parsed.repo,
    sourceType: "github",
    sourceRef,
    zipBuffer: buffer,
  });
}
