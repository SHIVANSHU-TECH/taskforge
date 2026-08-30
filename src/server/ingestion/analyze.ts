import type { AnalyzerResult, ExtractedFile, ExtractedProject, FileTreeNode } from "./types";

/** Dependency → framework label, checked in priority order (specific before generic). */
const FRAMEWORK_SIGNATURES: Array<[string, string]> = [
  ["next", "Next.js"],
  ["@remix-run/react", "Remix"],
  ["@remix-run/node", "Remix"],
  ["nuxt", "Nuxt"],
  ["@sveltejs/kit", "SvelteKit"],
  ["gatsby", "Gatsby"],
  ["astro", "Astro"],
  ["@angular/core", "Angular"],
  ["@nestjs/core", "NestJS"],
  ["react-scripts", "Create React App"],
  ["vue", "Vue"],
  ["svelte", "Svelte"],
  ["express", "Express"],
  ["fastify", "Fastify"],
  ["vite", "Vite"],
  ["react", "React"],
];

const ENTRY_POINT_CANDIDATES = [
  "app/page.tsx", "app/page.jsx", "app/page.js",
  "src/app/page.tsx", "src/app/page.js",
  "pages/index.tsx", "pages/index.js", "src/pages/index.tsx",
  "src/main.tsx", "src/main.ts", "src/main.jsx", "src/main.js",
  "src/index.tsx", "src/index.ts", "src/index.jsx", "src/index.js",
  "server.ts", "server.js", "index.html", "index.ts", "index.js",
];

const ENV_MAX = 300;

const ENV_PATTERNS = [
  /process\.env\.([A-Z_][A-Z0-9_]*)/g,
  /process\.env\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g,
  /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g,
];

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: { node?: string };
  packageManager?: string;
}

/** Picks the package.json closest to the project root (fewest path segments). */
function findPackageJson(files: ExtractedFile[]): ExtractedFile | null {
  let best: ExtractedFile | null = null;
  let bestDepth = Infinity;
  for (const f of files) {
    if (f.path === "package.json" || f.path.endsWith("/package.json")) {
      const depth = f.path.split("/").length;
      if (depth < bestDepth) {
        best = f;
        bestDepth = depth;
      }
    }
  }
  return best;
}

function detectPackageManager(paths: Set<string>, pkg: PackageJson | null): string | null {
  const lockfiles: Array<[string, string]> = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"],
  ];
  for (const [file, name] of lockfiles) {
    if (paths.has(file) || [...paths].some((p) => p.endsWith("/" + file))) return name;
  }
  if (pkg?.packageManager) return pkg.packageManager.split("@")[0];
  return null;
}

function scanEnvVars(files: ExtractedFile[]): string[] {
  const found = new Set<string>();
  for (const f of files) {
    if (f.text === undefined) continue;
    const base = f.path.slice(f.path.lastIndexOf("/") + 1).toLowerCase();

    // .env example files: collect the KEY of each KEY=value line.
    if (base.startsWith(".env")) {
      for (const line of f.text.split(/\r?\n/)) {
        const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
        if (m) found.add(m[1]);
      }
      continue;
    }

    for (const re of ENV_PATTERNS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(f.text)) !== null) {
        found.add(m[1]);
        if (found.size >= ENV_MAX) return [...found].sort();
      }
    }
  }
  return [...found].sort();
}

/** Builds a nested, sorted file tree (dirs first), capping children per directory. */
function buildFileTree(files: ExtractedFile[]): FileTreeNode {
  const PER_DIR_CAP = 500;
  const root: FileTreeNode = { name: "", path: "", type: "dir", children: [] };
  const dirs = new Map<string, FileTreeNode>([["", root]]);

  function ensureDir(dirPath: string): FileTreeNode {
    const existing = dirs.get(dirPath);
    if (existing) return existing;
    const name = dirPath.slice(dirPath.lastIndexOf("/") + 1);
    const parentPath = dirPath.includes("/") ? dirPath.slice(0, dirPath.lastIndexOf("/")) : "";
    const parent = ensureDir(parentPath);
    const node: FileTreeNode = { name, path: dirPath, type: "dir", children: [] };
    parent.children!.push(node);
    dirs.set(dirPath, node);
    return node;
  }

  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const segments = f.path.split("/");
    const fileName = segments.pop()!;
    const parent = ensureDir(segments.join("/"));
    parent.children!.push({ name: fileName, path: f.path, type: "file", size: f.size });
  }

  const sortAndCap = (node: FileTreeNode) => {
    if (!node.children) return;
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    if (node.children.length > PER_DIR_CAP) {
      node.children = node.children.slice(0, PER_DIR_CAP);
      node.truncated = true;
    }
    node.children.forEach(sortAndCap);
  };
  sortAndCap(root);
  return root;
}

/**
 * Analyzes an extracted project: framework, package manager, scripts, entry points,
 * dependency names, and referenced env-var NAMES (values are never read). Pure and
 * side-effect free so it can run inline now or in the worker later.
 */
export function analyzeProject(extracted: ExtractedProject): AnalyzerResult {
  const { files } = extracted;
  const paths = new Set(files.map((f) => f.path));

  let pkg: PackageJson | null = null;
  const pkgFile = findPackageJson(files);
  if (pkgFile?.text) {
    try {
      pkg = JSON.parse(pkgFile.text) as PackageJson;
    } catch {
      pkg = null;
    }
  }

  const depNames = pkg
    ? [...new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})])].sort()
    : [];
  const depSet = new Set(depNames);

  let framework: string | null = null;
  for (const [dep, label] of FRAMEWORK_SIGNATURES) {
    if (depSet.has(dep)) {
      framework = label;
      break;
    }
  }
  if (!framework && !pkg && paths.has("index.html")) framework = "Static site";

  let nodeVersion = pkg?.engines?.node ?? null;
  if (!nodeVersion) {
    const nvmrc = files.find((f) => f.path === ".nvmrc" || f.path.endsWith("/.nvmrc"));
    if (nvmrc?.text) nodeVersion = nvmrc.text.trim() || null;
  }

  const entryPoints = ENTRY_POINT_CANDIDATES.filter((c) => paths.has(c));

  return {
    framework,
    packageManager: detectPackageManager(paths, pkg),
    nodeVersion,
    scripts: pkg?.scripts ?? {},
    dependencies: depNames,
    entryPoints,
    envVars: scanEnvVars(files),
    fileCount: extracted.fileCount,
    sizeBytes: extracted.sizeBytes,
    fileTree: buildFileTree(files),
  };
}

/** Human-readable byte size, e.g. "1.4 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(1)} ${units[i]}`;
}
