import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_SEED } from "../engine/GeneratorRegistry";
import { obfuscatedFilename } from "../engine/batch";
import type {
  HarOverrides,
  HarStats,
  RedactionPolicy,
  RedactionTarget,
} from "../engine/har";
import type { HarWorkerRequest, HarWorkerResponse } from "../workers/har.worker";
import { errMsg } from "../utils/errMsg";

export type HarPhase = "idle" | "processing" | "done" | "error";

export interface HarObfuscatorState {
  phase: HarPhase;
  progress: { done: number; total: number } | null;
  stats: HarStats | null;
  targets: RedactionTarget[];
  resultBlob: Blob | null;
  resultName: string | null;
  error: string | null;
}

const IDLE: HarObfuscatorState = {
  phase: "idle",
  progress: null,
  stats: null,
  targets: [],
  resultBlob: null,
  resultName: null,
  error: null,
};

/**
 * Drives HAR obfuscation through an off-thread worker. Owns the worker
 * lifecycle: a fresh worker per run, terminated on completion, on error, on
 * reset, and on unmount — so a cancelled or abandoned run never leaks.
 *
 * Retains the last file so `reprocess` can re-run it with a changed redaction
 * policy without making the user re-pick the file.
 */
export function useHarObfuscator() {
  const [state, setState] = useState<HarObfuscatorState>(IDLE);
  const workerRef = useRef<Worker | null>(null);
  const fileRef = useRef<File | null>(null);

  const teardown = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  // Terminate any in-flight worker if the component unmounts mid-run.
  useEffect(() => teardown, [teardown]);

  const reset = useCallback(() => {
    teardown();
    fileRef.current = null;
    setState(IDLE);
  }, [teardown]);

  const run = useCallback(
    async (file: File, policy: RedactionPolicy, overrides: HarOverrides) => {
      teardown();
      setState({ ...IDLE, phase: "processing", progress: { done: 0, total: 0 } });

      let buffer: ArrayBuffer;
      try {
        buffer = await file.arrayBuffer();
      } catch (err) {
        setState({ ...IDLE, phase: "error", error: `Could not read file: ${errMsg(err)}` });
        return;
      }

      const worker = new Worker(
        new URL("../workers/har.worker.ts", import.meta.url),
        { type: "module" },
      );
      workerRef.current = worker;

      worker.onmessage = (e: MessageEvent<HarWorkerResponse>) => {
        const data = e.data;
        if (data.type === "progress") {
          setState((s) =>
            s.phase === "processing"
              ? { ...s, progress: { done: data.done, total: data.total } }
              : s,
          );
        } else if (data.type === "done") {
          setState({
            phase: "done",
            progress: null,
            stats: data.stats,
            targets: data.targets,
            resultBlob: data.blob,
            resultName: obfuscatedFilename(file.name),
            error: null,
          });
          teardown();
        } else {
          setState({ ...IDLE, phase: "error", error: data.message });
          teardown();
        }
      };

      worker.onerror = (e) => {
        setState({
          ...IDLE,
          phase: "error",
          error: e.message || "The HAR worker failed unexpectedly.",
        });
        teardown();
      };

      // Transfer the buffer zero-copy — after this the main thread no longer
      // holds the file bytes, halving peak memory across the two threads.
      const req: HarWorkerRequest = {
        buffer,
        options: { seed: DEFAULT_SEED, policy, overrides },
      };
      worker.postMessage(req, [buffer]);
    },
    [teardown],
  );

  /** Process a freshly picked file with the given policy + overrides. */
  const process = useCallback(
    (file: File, policy: RedactionPolicy, overrides: HarOverrides) => {
      fileRef.current = file;
      void run(file, policy, overrides);
    },
    [run],
  );

  /** Re-run the last file with updated policy + overrides. No-op if no file. */
  const reprocess = useCallback(
    (policy: RedactionPolicy, overrides: HarOverrides) => {
      if (fileRef.current) void run(fileRef.current, policy, overrides);
    },
    [run],
  );

  return { state, process, reprocess, reset, hasFile: () => fileRef.current !== null };
}
