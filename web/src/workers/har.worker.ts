// Off-thread HAR processing.
//
// HAR files run 75-250MB; parsing and walking one on the main thread would
// freeze the tab for many seconds. This worker owns the heavy work — decode,
// JSON.parse, processHar, re-serialize — and streams progress back so the UI
// stays responsive. See docs/har-support-research.md ("Option A").

import {
  processHar,
  type HarStats,
  type ProcessHarOptions,
  type RedactionTarget,
} from "../engine/har";
import { errMsg } from "../utils/errMsg";

/** Main thread -> worker: the raw file bytes (transferred zero-copy). */
export interface HarWorkerRequest {
  buffer: ArrayBuffer;
  options: ProcessHarOptions;
}

/** Worker -> main thread. */
export type HarWorkerResponse =
  | { type: "progress"; done: number; total: number }
  | {
      type: "done";
      blob: Blob;
      stats: HarStats;
      targets: RedactionTarget[];
    }
  | { type: "error"; message: string };

// `self` in a module worker; cast to Worker for a postMessage signature that
// doesn't demand a targetOrigin (the project's tsconfig has no WebWorker lib).
const ctx = self as unknown as Worker;

function post(msg: HarWorkerResponse): void {
  ctx.postMessage(msg);
}

ctx.onmessage = (e: MessageEvent<HarWorkerRequest>) => {
  const { buffer, options } = e.data;
  try {
    const text = new TextDecoder("utf-8").decode(buffer);
    const json: unknown = JSON.parse(text);

    // Throttle progress posts — a 10k-entry HAR would otherwise flood the
    // main thread with messages. One post per ~80ms is enough for a smooth bar.
    let lastPost = 0;
    const { har, stats, targets } = processHar(json, options, (done, total) => {
      const now = Date.now();
      if (done === total || now - lastPost > 80) {
        lastPost = now;
        post({ type: "progress", done, total });
      }
    });

    // Compact, not pretty-printed: indentation would inflate a 250MB HAR's
    // output by 20-40%, pushing peak memory toward the size ceiling. HAR is
    // consumed by tools (DevTools, viewers), not hand-read.
    const blob = new Blob([JSON.stringify(har)], { type: "application/json" });
    post({ type: "done", blob, stats, targets });
  } catch (err) {
    post({ type: "error", message: errMsg(err) });
  }
};
