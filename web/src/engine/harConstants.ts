// Hard size gates for HAR processing. A HAR is held in memory as a string,
// JSON-parsed into a tree, walked, and re-serialized — peak RAM runs roughly
// 5-8x the file size. These thresholds keep the tab inside what browsers can
// reliably handle. See docs/har-support-research.md ("Hard product gates").

/** At or below this, process silently with no warning. */
export const HAR_GATE_SILENT = 75 * 1024 * 1024;

/** Above this, refuse outright — browser tabs can't reliably parse it. */
export const HAR_GATE_MAX = 250 * 1024 * 1024;

/**
 * Mobile cap. Mobile Safari's ~384MB practical heap can OOM-kill the tab on a
 * 100MB HAR, so mobile browsers get the conservative limit regardless.
 */
export const HAR_GATE_MOBILE = 75 * 1024 * 1024;

export type HarGate =
  | { kind: "ok" }
  | { kind: "warn"; message: string }
  | { kind: "refuse"; message: string };

function formatMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}

/**
 * Decide whether a HAR of this byte size may be processed. `isMobile` tightens
 * the ceiling because mobile heaps are far smaller than desktop.
 */
export function checkHarGate(sizeBytes: number, isMobile: boolean): HarGate {
  if (isMobile && sizeBytes > HAR_GATE_MOBILE) {
    return {
      kind: "refuse",
      message:
        `Files over ${formatMb(HAR_GATE_MOBILE)} can crash mobile browser ` +
        `tabs. Try this HAR on a desktop browser, or record in shorter bursts.`,
    };
  }
  if (sizeBytes > HAR_GATE_MAX) {
    return {
      kind: "refuse",
      message:
        `Files over ${formatMb(HAR_GATE_MAX)} exceed what browser tabs can ` +
        `reliably handle. Try recording in shorter bursts, or split the HAR ` +
        `before uploading.`,
    };
  }
  if (sizeBytes > HAR_GATE_SILENT) {
    return {
      kind: "warn",
      message:
        `This is a large file (${formatMb(sizeBytes)}). Processing may take ` +
        `a moment and use significant memory.`,
    };
  }
  return { kind: "ok" };
}
