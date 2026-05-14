import { useCallback, useState } from "react";
import {
  processBatch,
  detectSchemaFromFile,
  type BatchFile,
  type BatchResult,
  type DetectedSchema,
} from "../engine/batch";
import { DEFAULT_SEED } from "../engine/GeneratorRegistry";
import type { EndpointSpec } from "../engine/types";

export function useBatchObfuscator() {
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const [valueOverrides, setValueOverrides] = useState<Map<string, string>>(
    new Map(),
  );
  const [consistent, setConsistent] = useState(true);
  const [results, setResults] = useState<Map<string, BatchResult>>(new Map());
  const [seed, setSeed] = useState(DEFAULT_SEED);

  const detect = useCallback(
    (text: string, endpoint: EndpointSpec | null): DetectedSchema | null =>
      detectSchemaFromFile(text, endpoint, overrides, valueOverrides),
    [overrides, valueOverrides],
  );

  const run = useCallback(
    (files: BatchFile[], endpoint: EndpointSpec | null) => {
      const out = processBatch(files, {
        overrides,
        valueOverrides,
        endpoint,
        consistent,
        initialSeed: seed,
      });
      const map = new Map<string, BatchResult>();
      for (const r of out) map.set(r.fileId, r);
      setResults(map);
      return out;
    },
    [overrides, valueOverrides, consistent, seed],
  );

  const setOverride = useCallback(
    (path: string, enabled: boolean | undefined) => {
      setOverrides((prev) => {
        const next = new Map(prev);
        if (enabled === undefined) next.delete(path);
        else next.set(path, enabled);
        return next;
      });
    },
    [],
  );

  const setValueOverride = useCallback(
    (path: string, value: string | null) => {
      setValueOverrides((prev) => {
        const next = new Map(prev);
        if (value === null) next.delete(path);
        else next.set(path, value);
        return next;
      });
    },
    [],
  );

  const resetOverrides = useCallback(() => {
    setOverrides(new Map());
    setValueOverrides(new Map());
  }, []);

  const clearResults = useCallback(() => {
    setResults(new Map());
  }, []);

  const reseed = useCallback(() => {
    setSeed((Math.random() * 0xffffffff) >>> 0);
  }, []);

  return {
    overrides,
    valueOverrides,
    consistent,
    setConsistent,
    setOverride,
    setValueOverride,
    resetOverrides,
    results,
    run,
    detect,
    clearResults,
    reseed,
    seed,
  };
}
