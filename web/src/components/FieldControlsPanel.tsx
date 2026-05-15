import { useState, useMemo } from "react";
import { PanelRightClose, RotateCcw, Search, X, Bookmark } from "lucide-react";
import type { FieldSummary, TransformResult } from "../engine/TransformEngine";
import { aggregate, buildTree, filterTree, type TreeNode } from "./fields/tree";
import { TreeNodeRow } from "./fields/TreeNodeRow";

interface Props {
  fields: FieldSummary[];
  stats: TransformResult["stats"] | null;
  overrideCount: number;
  hasSaved: boolean;
  valueOverrides: Map<string, string>;
  onToggle: (path: string, enabled: boolean | undefined) => void;
  onSetValueOverride: (path: string, value: string | null) => void;
  onReset: () => void;
  // Optional: when omitted, the hide button is not rendered. Useful for
  // contexts where hiding the panel doesn't make sense - batch mode (the
  // panel is the only right-hand UI) and the stacked tablet/mobile layout
  // (there is no "right" to hide into).
  onHide?: () => void;
  style?: React.CSSProperties;
}

export function FieldControlsPanel({
  fields,
  stats,
  overrideCount,
  hasSaved,
  valueOverrides,
  onToggle,
  onSetValueOverride,
  onReset,
  onHide,
  style,
}: Props) {
  const [flipped, setFlipped] = useState<Set<string>>(() => new Set<string>());
  const [query, setQuery] = useState("");
  const [editingPath, setEditingPath] = useState<string | null>(null);

  const tree = useMemo(() => buildTree(fields), [fields]);

  const defaultOpenPaths = useMemo(() => {
    const out = new Set<string>();
    const visit = (n: TreeNode) => {
      if (n.children.length === 0) return;
      out.add(n.fullPath);
      for (const c of n.children) visit(c);
    };
    for (const root of tree) visit(root);
    return out;
  }, [tree]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!q) return tree;
    return tree.map((n) => filterTree(n, q)).filter(Boolean) as TreeNode[];
  }, [tree, q]);

  const totals = useMemo(() => {
    let o = 0,
      t = 0;
    for (const n of tree) {
      const a = aggregate(n);
      o += a.obfuscated;
      t += a.total;
    }
    return { obfuscated: o, total: t };
  }, [tree]);

  const toggleNode = (path: string) =>
    setFlipped((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const isExpanded = (path: string): boolean => {
    if (q) return true;
    const defaultExpanded = defaultOpenPaths.has(path);
    return flipped.has(path) ? !defaultExpanded : defaultExpanded;
  };

  return (
    <aside className="pane fields-panel" style={style}>
      <div className="pane-header">
        <label className="pane-label">Field controls</label>
        <span className="format-pill">
          {totals.total > 0 ? `${totals.obfuscated}/${totals.total}` : "0"}
        </span>
        {hasSaved && (
          <span
            className="saved-pill"
            title="Your overrides for this endpoint are saved locally and will re-apply next time."
          >
            <Bookmark size={10} />
            saved
          </span>
        )}
        <div className="pane-actions">
          {overrideCount > 0 && (
            <button onClick={onReset} title={`Reset ${overrideCount} override${overrideCount === 1 ? "" : "s"} and clear saved`}>
              <RotateCcw size={12} />
              <span className="btn-label">Reset {overrideCount}</span>
            </button>
          )}
          {onHide && (
            <button onClick={onHide} title="Hide field controls panel" aria-label="Hide">
              <PanelRightClose size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="fields-search">
        <Search size={12} />
        <input
          type="text"
          placeholder="Filter by path…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            className="fields-search-clear"
            onClick={() => setQuery("")}
            title="Clear filter"
            aria-label="Clear filter"
          >
            <X size={12} />
          </button>
        )}
      </div>
      {stats && (
        <div className="fields-stats">
          <span className="stat stat-faked" title="Fields replaced via field-map rule">
            <strong>{stats.fieldsTransformed}</strong> faked
          </span>
          <span className="stat stat-generic" title="Fields replaced via generic pattern detector">
            <strong>{stats.fieldsFromGeneric}</strong> generic
          </span>
          <span className="stat stat-preserved" title="Fields kept as the original value">
            <strong>{stats.fieldsPreserved}</strong> preserved
          </span>
          <span className="stat stat-cache" title="Anchored values reused from the consistency cache">
            <strong>{stats.cacheHits}</strong> cached
          </span>
        </div>
      )}
      <div className="fields-body">
        {tree.length === 0 ? (
          <p className="fields-empty">Paste a response to see detected fields.</p>
        ) : visible.length === 0 ? (
          <p className="fields-empty">No fields match “{query}”.</p>
        ) : (
          <ul className="field-tree">
            {visible.map((n) => (
              <TreeNodeRow
                key={n.fullPath}
                node={n}
                depth={0}
                isExpanded={isExpanded}
                onToggleExpand={toggleNode}
                onToggleField={onToggle}
                valueOverrides={valueOverrides}
                onSetValueOverride={onSetValueOverride}
                editingPath={editingPath}
                setEditingPath={setEditingPath}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
