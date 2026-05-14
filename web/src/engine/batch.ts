import type { EndpointSpec } from "./types";
import {
  TransformEngine,
  type FieldSummary,
  type TransformResult,
} from "./TransformEngine";
import { ConsistencyCache } from "./Cache";
import { DEFAULT_SEED, GeneratorRegistry } from "./GeneratorRegistry";
import { parseInput, serialize, type InputFormat } from "./xml";

export interface BatchFile {
  id: string;
  name: string;
  text: string;
  size: number;
}

export type BatchFileStatus =
  | { kind: "pending" }
  | { kind: "done"; outputText: string; format: InputFormat }
  | { kind: "error"; message: string };

export interface BatchResult {
  fileId: string;
  status: BatchFileStatus;
}

export interface BatchOptions {
  overrides: Map<string, boolean>;
  valueOverrides: Map<string, string>;
  endpoint: EndpointSpec | null;
  /** When true, all files share one cache + seed → same real value yields same fake across the batch. */
  consistent: boolean;
  initialSeed: number;
}

export function processBatch(
  files: BatchFile[],
  options: BatchOptions,
): BatchResult[] {
  const sharedCache = new ConsistencyCache();
  const sharedGenerators = new GeneratorRegistry(options.initialSeed);
  const sharedEngine = new TransformEngine(sharedGenerators, sharedCache);

  return files.map((file) => {
    try {
      const parsed = parseInput(file.text);
      let engine = sharedEngine;
      if (!options.consistent) {
        const cache = new ConsistencyCache();
        const generators = new GeneratorRegistry(options.initialSeed);
        generators.newSeed();
        engine = new TransformEngine(generators, cache);
      }
      const result = engine.transform(
        parsed.data,
        options.endpoint,
        options.overrides,
        options.valueOverrides,
      );
      return {
        fileId: file.id,
        status: {
          kind: "done",
          outputText: serialize(result.output, parsed),
          format: parsed.format,
        },
      };
    } catch (err) {
      return {
        fileId: file.id,
        status: {
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  });
}

export interface DetectedSchema {
  fields: FieldSummary[];
  stats: TransformResult["stats"];
  format: InputFormat;
}

export function detectSchemaFromFile(
  text: string,
  endpoint: EndpointSpec | null,
  overrides: Map<string, boolean> = new Map(),
  valueOverrides: Map<string, string> = new Map(),
): DetectedSchema | null {
  try {
    const parsed = parseInput(text);
    const cache = new ConsistencyCache();
    const generators = new GeneratorRegistry(DEFAULT_SEED);
    const engine = new TransformEngine(generators, cache);
    const result = engine.transform(
      parsed.data,
      endpoint,
      overrides,
      valueOverrides,
    );
    return {
      fields: result.fields,
      stats: result.stats,
      format: parsed.format,
    };
  } catch {
    return null;
  }
}

export function obfuscatedFilename(originalName: string): string {
  const dot = originalName.lastIndexOf(".");
  if (dot <= 0) return `${originalName}.obfuscated`;
  const stem = originalName.slice(0, dot);
  const ext = originalName.slice(dot);
  return `${stem}.obfuscated${ext}`;
}
