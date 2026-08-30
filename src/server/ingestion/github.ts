import { getEnv } from "../../lib/env";
import { INGEST_LIMITS } from "./types";

export interface ParsedRepo {
  owner: string;
  repo: string;
  ref?: string;
}

const NAME_RE = /^[A-Za-z0-9_.-]+$/;

/**
 * Parses the many shapes a GitHub reference can take:
 *   https://github.com/owner/repo(.git)
 *   https://github.com/owner/repo/tree/branch(/subpath)
 *   git@github.com:owner/repo.git
 *   owner/repo    owner/repo@ref
 * Only github.com is accepted (guards against SSRF to arbitrary hosts).
 */
export function parseGithubUrl(input: string): ParsedRepo {
  const s = input.trim();
  let owner = "";
  let repo = "";
  let ref: string | undefined;

  const ssh = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/.exec(s);
  if (ssh) {
    owner = ssh[1];
    repo = ssh[2];
  } else if (/^https?:\/\//i.test(s) || /^(www\.)?github\.com\//i.test(s)) {
    let u: URL;
    try {
      u = new URL(s.startsWith("http") ? s : `https://${s}`);
    } catch {
      throw new Error("That doesn't look like a valid URL.");
    }
    if (u.hostname !== "github.com" && u.hostname !== "www.github.com") {
      throw new Error("Only github.com repositories are supported.");
    }
    const parts = u.pathname.replace(/^\/+/, "").split("/");
    owner = parts[0] ?? "";
    repo = (parts[1] ?? "").replace(/\.git$/, "");
    if (parts[2] === "tree" && parts[3]) ref = decodeURIComponent(parts[3]);
  } else {
    const m = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:@(.+))?$/.exec(s);
    if (m) {
      owner = m[1];
      repo = m[2];
      ref = m[3];
    }
  }

  if (!owner || !repo || !NAME_RE.test(owner) || !NAME_RE.test(repo)) {
    throw new Error("Could not parse an owner/repo from that input.");
  }
  return { owner, repo, ref };
}

export interface FetchedArchive {
  buffer: Buffer;
  resolvedRef?: string;
}

/**
 * Downloads a repo archive as a ZIP via the GitHub zipball API. Uses GITHUB_TOKEN
 * when set (private repos + higher rate limits). Omitting `ref` yields the default branch.
 */
export async function fetchGithubArchive({ owner, repo, ref }: ParsedRepo): Promise<FetchedArchive> {
  const token = getEnv().GITHUB_TOKEN;
  const base = `https://api.github.com/repos/${owner}/${repo}/zipball`;
  const url = ref ? `${base}/${encodeURIComponent(ref)}` : base;

  const headers: Record<string, string> = {
    "User-Agent": "TaskForge-AI",
    Accept: "application/vnd.github+json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetchFollowingGithubRedirects(url, headers);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Refusing")) throw e;
    throw new Error("Could not reach GitHub. Check your network connection.");
  }

  if (res.status === 404) {
    throw new Error(
      token
        ? `Repository ${owner}/${repo} not found (or the token lacks access).`
        : `Repository ${owner}/${repo} not found. If it's private, set GITHUB_TOKEN.`,
    );
  }
  if (res.status === 403) {
    throw new Error(
      "GitHub rate limit hit or access forbidden. Set GITHUB_TOKEN to raise the limit.",
    );
  }
  if (!res.ok) {
    throw new Error(`GitHub returned ${res.status} ${res.statusText}.`);
  }

  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared && declared > INGEST_LIMITS.maxArchiveBytes) {
    throw new Error(
      `Repository archive is ${(declared / 1024 / 1024).toFixed(0)} MB, exceeding the ` +
        `${INGEST_LIMITS.maxArchiveBytes / 1024 / 1024} MB limit.`,
    );
  }

  // Stream with a hard cap so a missing/dishonest content-length can't OOM us.
  const buffer = await readCapped(res, INGEST_LIMITS.maxArchiveBytes);
  // GitHub encodes the resolved commit-ish in the content-disposition filename.
  const disposition = res.headers.get("content-disposition") ?? "";
  const nameMatch = /filename=([^;]+)/.exec(disposition);
  const resolvedRef = ref ?? undefined;

  return { buffer, resolvedRef: resolvedRef ?? extractRefFromFilename(nameMatch?.[1]) };
}

/**
 * Follows redirects manually, validating each hop's host against a GitHub
 * allow-list. The zipball API 302-redirects to codeload.github.com; without
 * re-validation a compromised/edge-case redirect could point the fetch (and,
 * on same-site hops, the Authorization header) at an arbitrary host — an SSRF
 * vector. The Authorization header is dropped once we leave api.github.com.
 */
async function fetchFollowingGithubRedirects(
  startUrl: string,
  headers: Record<string, string>,
): Promise<Response> {
  const ALLOWED_HOSTS = new Set([
    "api.github.com",
    "github.com",
    "www.github.com",
    "codeload.github.com",
  ]);
  const isAllowed = (host: string) =>
    ALLOWED_HOSTS.has(host) || host.endsWith(".githubusercontent.com");

  let url = startUrl;
  for (let hop = 0; hop < 5; hop++) {
    const host = new URL(url).hostname;
    if (!isAllowed(host)) {
      throw new Error(`Refusing to follow redirect to non-GitHub host: ${host}`);
    }
    // Only send the token to the GitHub API host; never to codeload/CDN hops.
    const hopHeaders = { ...headers };
    if (host !== "api.github.com") delete hopHeaders.Authorization;

    const res = await fetch(url, { headers: hopHeaders, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res;
      url = new URL(location, url).toString();
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects while contacting GitHub.");
}

/** GitHub names the archive `owner-repo-<sha>.zip`; recover a short sha for display. */
function extractRefFromFilename(filename: string | undefined): string | undefined {
  if (!filename) return undefined;
  const m = /-([0-9a-f]{7,40})\.zip/i.exec(filename.trim());
  return m ? m[1].slice(0, 7) : undefined;
}

/**
 * Reads a response body into a Buffer, aborting once `maxBytes` is exceeded so a
 * server that under-reports (or omits) content-length can't exhaust memory.
 */
async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  if (!res.body) return Buffer.from(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const limitMb = (maxBytes / 1024 / 1024).toFixed(0);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          throw new Error(`Repository archive exceeds the ${limitMb} MB limit.`);
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
