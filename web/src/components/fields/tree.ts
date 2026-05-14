import type { FieldSummary } from "../../engine/TransformEngine";
import type { JsonValue } from "../../engine/types";

export interface TreeNode {
  segment: string;
  fullPath: string;
  field: FieldSummary | null;
  children: TreeNode[];
}

const NON_OBFUSCATED = new Set(["preserve", "auto", "null"]);

export function isObfuscatedType(t: string): boolean {
  return !NON_OBFUSCATED.has(t);
}

export function truncate(value: JsonValue, max = 28): string {
  let s: string;
  if (value === null) s = "null";
  else if (typeof value === "string") s = `"${value}"`;
  else s = String(value);
  if (s.length > max) s = s.slice(0, max - 1) + "…";
  return s;
}

export function buildTree(fields: FieldSummary[]): TreeNode[] {
  const root: TreeNode = { segment: "", fullPath: "", field: null, children: [] };
  for (const f of fields) {
    const segments = f.path.split(".");
    let node = root;
    let acc = "";
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      acc = acc ? `${acc}.${seg}` : seg;
      let child = node.children.find((c) => c.segment === seg);
      if (!child) {
        child = { segment: seg, fullPath: acc, field: null, children: [] };
        node.children.push(child);
      }
      if (i === segments.length - 1) child.field = f;
      node = child;
    }
  }
  return root.children;
}

export function aggregate(node: TreeNode): { obfuscated: number; total: number } {
  if (node.field) {
    return {
      obfuscated: isObfuscatedType(node.field.effectiveType) ? 1 : 0,
      total: 1,
    };
  }
  let o = 0,
    t = 0;
  for (const c of node.children) {
    const a = aggregate(c);
    o += a.obfuscated;
    t += a.total;
  }
  return { obfuscated: o, total: t };
}

// Convert a normalized field path (e.g. `data[].customer.email`) to a JS
// optional-chaining accessor users can paste straight into code. Wildcards
// resolve to index `0` since that's the most useful first-element example.
// Non-identifier keys fall back to bracket access.
const IDENT_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

export function pathToOptionalChaining(path: string): string {
  if (!path) return "";
  const segments = path.split(".");
  const parts: string[] = [];
  segments.forEach((seg, i) => {
    const m = seg.match(/^([^[\]]*)((?:\[\])*)$/);
    const name = m?.[1] ?? seg;
    const brackets = m?.[2] ?? "";
    if (name) {
      const isFirst = i === 0;
      if (IDENT_RE.test(name)) {
        parts.push(isFirst ? name : `?.${name}`);
      } else {
        parts.push(isFirst ? `["${name}"]` : `?.["${name}"]`);
      }
    }
    const arrayCount = brackets.length / 2;
    for (let a = 0; a < arrayCount; a++) parts.push("?.[0]");
  });
  return parts.join("");
}

export function filterTree(node: TreeNode, q: string): TreeNode | null {
  if (!q) return node;
  if (node.field) {
    return node.fullPath.toLowerCase().includes(q) ? node : null;
  }
  const kept: TreeNode[] = [];
  for (const c of node.children) {
    const k = filterTree(c, q);
    if (k) kept.push(k);
  }
  if (kept.length === 0) return null;
  return { ...node, children: kept };
}
