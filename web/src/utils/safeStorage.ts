// Thin wrapper around `localStorage` that swallows access errors so callers
// don't have to repeat the try/catch dance.
//
// `localStorage` access can throw in three common situations:
//   1. Private/Incognito mode in some browsers (Safari historically),
//   2. Storage quota exceeded on write,
//   3. Storage disabled by enterprise/browser policy.
//
// Every error here is non-fatal for this app — the worst case is "the user
// loses persistence for this session," which is strictly better than crashing.
export const safeStorage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode / quota / disabled — ignore */
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
  // Enumerate every key currently under a given prefix. Used by the
  // "Forget everything" panic button so the user can see (and clear) the
  // full set of app-owned localStorage entries.
  keysWithPrefix(prefix: string): string[] {
    try {
      const out: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) out.push(k);
      }
      return out;
    } catch {
      return [];
    }
  },
  removeWithPrefix(prefix: string): number {
    const keys = this.keysWithPrefix(prefix);
    for (const k of keys) this.remove(k);
    return keys.length;
  },
};

// Single source of truth for the localStorage namespace this app owns.
// Used both by individual hooks (via the per-feature key constants) and by
// the panic-button code-path that wipes everything under it.
export const STORAGE_NAMESPACE = "doppelforge.";
