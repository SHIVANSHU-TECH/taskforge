import { File as FileIcon, Folder } from "lucide-react";
import { formatBytes } from "@/server/ingestion/analyze";
import type { FileTreeNode } from "@/server/ingestion/types";

/** Static, indented file tree for the Project Files browser (read-only in Phase 2). */
export function FileTree({ root }: { root: FileTreeNode }) {
  if (!root.children || root.children.length === 0) {
    return <p className="text-sm text-muted-foreground">No files.</p>;
  }
  return (
    <ul className="font-mono text-sm">
      {root.children.map((child) => (
        <TreeNode key={child.path} node={child} depth={0} />
      ))}
    </ul>
  );
}

function TreeNode({ node, depth }: { node: FileTreeNode; depth: number }) {
  const indent = { paddingLeft: `${depth * 16 + 8}px` };

  if (node.type === "dir") {
    return (
      <li>
        <div style={indent} className="flex items-center gap-2 py-0.5">
          <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="font-medium">{node.name}</span>
        </div>
        {node.children && node.children.length > 0 && (
          <ul>
            {node.children.map((child) => (
              <TreeNode key={child.path} node={child} depth={depth + 1} />
            ))}
          </ul>
        )}
        {node.truncated && (
          <div
            style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
            className="py-0.5 text-xs italic text-muted-foreground"
          >
            … more entries hidden
          </div>
        )}
      </li>
    );
  }

  return (
    <li>
      <div style={indent} className="flex items-center gap-2 py-0.5">
        <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span>{node.name}</span>
        {typeof node.size === "number" && (
          <span className="text-xs text-muted-foreground">{formatBytes(node.size)}</span>
        )}
      </div>
    </li>
  );
}
