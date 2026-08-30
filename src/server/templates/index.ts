import { prisma } from "../../lib/db";
import { getStorageProvider } from "../storage";
import { analyzeProject } from "../ingestion/analyze";
import { extractZip } from "../ingestion/extract";
import type { AnalyzerResult } from "../ingestion/types";

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

interface IngestTemplateArgs {
  organizationId: string;
  name: string;
  /** Free-text note: what to do / copy / take from this reference archive. */
  prompt: string;
  filename: string;
  zipBuffer: Buffer;
}

/**
 * Ingests a reference Template: validate + extract → analyze → create row → store
 * the raw archive → persist analysis. Mirrors project ingestion but is org-scoped
 * and standalone (no workspace). The raw archive is rolled back-safe: validation
 * runs before any DB write, and the Template row is deleted if storage fails.
 */
export async function ingestTemplate(
  args: IngestTemplateArgs,
): Promise<{ templateId: string }> {
  // Throws on unsafe/oversized/invalid archives — before we touch the DB.
  const extracted = extractZip(args.zipBuffer);
  const analysis = analyzeProject(extracted);

  const template = await prisma.template.create({
    data: {
      organizationId: args.organizationId,
      name: args.name,
      prompt: args.prompt,
      sourceRef: args.filename,
      ...analysisData(analysis),
    },
  });

  try {
    const storage = getStorageProvider();
    const key = `templates/${template.id}/source.zip`;
    await storage.put(key, args.zipBuffer, { contentType: "application/zip" });
    await prisma.template.update({ where: { id: template.id }, data: { storageKey: key } });
  } catch (err) {
    await prisma.template.delete({ where: { id: template.id } }).catch(() => {});
    throw err;
  }

  return { templateId: template.id };
}
