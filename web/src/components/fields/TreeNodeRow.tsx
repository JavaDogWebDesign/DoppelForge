import { useState } from "react";
import { ChevronDown, ChevronRight, Copy, Check, Pencil } from "lucide-react";
import {
  aggregate,
  isObfuscatedType,
  pathToOptionalChaining,
  truncate,
  type TreeNode,
} from "./tree";
import { InlineEditor } from "./InlineEditor";

// Stack offset for sticky container rows: each deeper level pins this many
// pixels below the previous one, so the path is always readable as a stack.
const STICKY_ROW_HEIGHT = 26;

interface Props {
  node: TreeNode;
  depth: number;
  isExpanded: (path: string) => boolean;
  onToggleExpand: (path: string) => void;
  onToggleField: (path: string, enabled: boolean | undefined) => void;
  valueOverrides: Map<string, string>;
  onSetValueOverride: (path: string, value: string | null) => void;
  editingPath: string | null;
  setEditingPath: (path: string | null) => void;
}

export function TreeNodeRow({
  node,
  depth,
  isExpanded,
  onToggleExpand,
  onToggleField,
  valueOverrides,
  onSetValueOverride,
  editingPath,
  setEditingPath,
}: Props) {
  const indent = 12 + depth * 14;

  if (node.field) {
    const f = node.field;
    const literal = valueOverrides.get(f.path);
    const editing = editingPath === f.path;
    const hasLiteral = literal !== undefined;
    const isObfuscated = hasLiteral || isObfuscatedType(f.effectiveType);
    const defaultIsObfuscated = isObfuscatedType(f.defaultType);
    const accessor = pathToOptionalChaining(f.path);

    return (
      <li className="tree-node">
        <div
          className={`tree-row leaf${f.overridden ? " overridden" : ""}${hasLiteral ? " custom" : ""}`}
          style={{ paddingLeft: indent }}
        >
          <label className="field-toggle">
            <input
              type="checkbox"
              checked={isObfuscated}
              onChange={(e) => {
                const desired = e.target.checked;
                // Toggling off any kind of override clears the literal too.
                if (!desired && hasLiteral) onSetValueOverride(f.path, null);
                if (desired === defaultIsObfuscated) onToggleField(f.path, undefined);
                else onToggleField(f.path, desired);
              }}
            />
          </label>
          {editing ? (
            <InlineEditor
              initial={literal ?? String(f.sampleOriginal)}
              onCommit={(v) => {
                onSetValueOverride(f.path, v.length > 0 ? v : null);
                setEditingPath(null);
              }}
              onCancel={() => setEditingPath(null)}
            />
          ) : (
            <>
              <div className="field-main">
                <code className="field-path">{node.segment}</code>
                <span className="field-sample">
                  {truncate(f.sampleOriginal)}
                  {isObfuscated && (
                    <>
                      <span className="arrow"> → </span>
                      <span className="fake">{truncate(f.sampleFake)}</span>
                    </>
                  )}
                </span>
              </div>
              <span
                className={`field-type type-${hasLiteral ? "custom" : f.effectiveType}`}
                title={
                  hasLiteral
                    ? `Manual override (default: ${f.defaultType})`
                    : f.defaultType !== f.effectiveType
                      ? `Overridden from default: ${f.defaultType}`
                      : undefined
                }
              >
                {hasLiteral ? "custom" : f.effectiveType}
              </span>
              <CopyAccessorButton accessor={accessor} />
              <button
                className={`field-edit-btn${hasLiteral ? " active" : ""}`}
                onClick={() => setEditingPath(f.path)}
                title={hasLiteral ? "Edit custom value" : "Set a custom value for this field"}
                aria-label="Edit value"
              >
                <Pencil size={11} />
              </button>
            </>
          )}
        </div>
      </li>
    );
  }

  // Container row. The wrapping <li> is the containing block for the sticky
  // row, so the parent stays pinned only while its own subtree is in view -
  // once the last child scrolls past, the parent scrolls out with the <li>.
  const open = isExpanded(node.fullPath);
  const agg = aggregate(node);

  return (
    <li className="tree-node">
      <div
        className="tree-row container"
        style={{
          paddingLeft: indent,
          ["--sticky-top" as string]: `${depth * STICKY_ROW_HEIGHT}px`,
          ["--sticky-z" as string]: `${100 - depth}`,
        }}
        onClick={() => onToggleExpand(node.fullPath)}
      >
        <span className="chevron">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <code className="field-path container-path">{node.segment}</code>
        <span className="container-count">
          {agg.obfuscated}/{agg.total}
        </span>
      </div>
      {open && (
        <ul className="field-tree">
          {node.children.map((c) => (
            <TreeNodeRow
              key={c.fullPath}
              node={c}
              depth={depth + 1}
              isExpanded={isExpanded}
              onToggleExpand={onToggleExpand}
              onToggleField={onToggleField}
              valueOverrides={valueOverrides}
              onSetValueOverride={onSetValueOverride}
              editingPath={editingPath}
              setEditingPath={setEditingPath}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function CopyAccessorButton({ accessor }: { accessor: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!accessor) return;
    try {
      await navigator.clipboard.writeText(accessor);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard may be blocked; ignore */
    }
  };
  return (
    <button
      className={`field-edit-btn${copied ? " active" : ""}`}
      onClick={onClick}
      title={`Copy accessor: ${accessor}`}
      aria-label="Copy accessor"
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
    </button>
  );
}
