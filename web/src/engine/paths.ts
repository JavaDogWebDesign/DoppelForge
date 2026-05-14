export function normalizePath(path: string): string {
  return path.replace(/\[\d+\]/g, "[]");
}

export function pathTail(path: string): string {
  const m = path.match(/([a-zA-Z0-9_]+)(?:\[\d+\])?$/);
  return m ? m[1] : "";
}
