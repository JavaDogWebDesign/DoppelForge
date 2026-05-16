/** Normalize an unknown thrown value to a human-readable string. */
export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
