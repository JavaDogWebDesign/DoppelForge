import { useCallback, useEffect, useRef, useState } from "react";
import { ConsistencyCache } from "../engine/Cache";
import { DEFAULT_SEED, GeneratorRegistry } from "../engine/GeneratorRegistry";
import { TransformEngine, type TransformResult } from "../engine/TransformEngine";
import type { EndpointSpec, JsonValue } from "../engine/types";
import { safeStorage } from "../utils/safeStorage";

const STORAGE_PREFIX = "doppelforge.overrides.";
// Generic scope has no stable identity worth persisting - skip storage so a
// generic-mode session doesn't leak overrides into the next paste.
const GENERIC_SCOPE = "none::generic";

interface StoredOverrides {
  overrides: Array<[string, boolean]>;
  valueOverrides: Array<[string, string]>;
}

function storageKey(scopeKey: string): string {
  return STORAGE_PREFIX + scopeKey;
}

function loadSaved(scopeKey: string | null): StoredOverrides | null {
  if (!scopeKey || scopeKey === GENERIC_SCOPE) return null;
  const raw = safeStorage.get(storageKey(scopeKey));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredOverrides;
    if (
      !parsed ||
      !Array.isArray(parsed.overrides) ||
      !Array.isArray(parsed.valueOverrides)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function persistSaved(
  scopeKey: string | null,
  overrides: Map<string, boolean>,
  valueOverrides: Map<string, string>,
): void {
  if (!scopeKey || scopeKey === GENERIC_SCOPE) return;
  if (overrides.size === 0 && valueOverrides.size === 0) {
    safeStorage.remove(storageKey(scopeKey));
    return;
  }
  const payload: StoredOverrides = {
    overrides: Array.from(overrides.entries()),
    valueOverrides: Array.from(valueOverrides.entries()),
  };
  safeStorage.set(storageKey(scopeKey), JSON.stringify(payload));
}

function dropSaved(scopeKey: string | null): void {
  if (!scopeKey || scopeKey === GENERIC_SCOPE) return;
  safeStorage.remove(storageKey(scopeKey));
}

export interface ObfuscatorState {
  cacheSize: number;
  seed: number;
}

export function useObfuscator(scopeKey: string | null) {
  const cacheRef = useRef(new ConsistencyCache());
  const generatorsRef = useRef(new GeneratorRegistry(DEFAULT_SEED));
  const engineRef = useRef(
    new TransformEngine(generatorsRef.current, cacheRef.current),
  );
  const [state, setState] = useState<ObfuscatorState>({
    cacheSize: 0,
    seed: DEFAULT_SEED,
  });
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const [valueOverrides, setValueOverrides] = useState<Map<string, string>>(new Map());
  // Whether the current scope has *any* persisted overrides backing it,
  // surfaced to the UI so users know their toggles are sticky.
  const [hasSaved, setHasSaved] = useState<boolean>(false);

  // On scope change: replace in-memory state with whatever is saved for that
  // scope (or empty maps). Skips persistence for the generic scope.
  useEffect(() => {
    const saved = loadSaved(scopeKey);
    if (saved) {
      setOverrides(new Map(saved.overrides));
      setValueOverrides(new Map(saved.valueOverrides));
      setHasSaved(true);
    } else {
      setOverrides(new Map());
      setValueOverrides(new Map());
      setHasSaved(false);
    }
  }, [scopeKey]);

  const obfuscate = useCallback(
    (input: JsonValue, endpoint: EndpointSpec | null): TransformResult => {
      const result = engineRef.current.transform(input, endpoint, overrides, valueOverrides);
      setState((s) => ({ ...s, cacheSize: cacheRef.current.size }));
      return result;
    },
    [overrides, valueOverrides],
  );

  // Side effects (localStorage + sibling state) live outside the state
  // updater. React may invoke functional updaters more than once under Strict
  // Mode, which would double-write storage and race setHasSaved against
  // itself; computing `next` from closure state keeps the work idempotent.
  const setOverride = useCallback(
    (path: string, enabled: boolean | undefined) => {
      const next = new Map(overrides);
      if (enabled === undefined) next.delete(path);
      else next.set(path, enabled);
      setOverrides(next);
      persistSaved(scopeKey, next, valueOverrides);
      setHasSaved(next.size > 0 || valueOverrides.size > 0);
    },
    [overrides, scopeKey, valueOverrides],
  );

  const setValueOverride = useCallback(
    (path: string, value: string | null) => {
      const next = new Map(valueOverrides);
      if (value === null) next.delete(path);
      else next.set(path, value);
      setValueOverrides(next);
      persistSaved(scopeKey, overrides, next);
      setHasSaved(overrides.size > 0 || next.size > 0);
    },
    [valueOverrides, scopeKey, overrides],
  );

  const resetOverrides = useCallback(() => {
    setOverrides(new Map());
    setValueOverrides(new Map());
    dropSaved(scopeKey);
    setHasSaved(false);
  }, [scopeKey]);

  const clearCache = useCallback(() => {
    cacheRef.current.clear();
    setState((s) => ({ ...s, cacheSize: 0 }));
  }, []);

  const newSeed = useCallback(() => {
    const s = generatorsRef.current.newSeed();
    cacheRef.current.clear();
    setState({ cacheSize: 0, seed: s });
  }, []);

  return {
    obfuscate,
    clearCache,
    newSeed,
    state,
    overrides,
    valueOverrides,
    setOverride,
    setValueOverride,
    resetOverrides,
    hasSaved,
  };
}
