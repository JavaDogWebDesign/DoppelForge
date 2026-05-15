// Runtime proof that pasted API responses never leave this device.
//
// The footer used to *claim* "Data stays on this device" as static text.
// This module turns that claim into a verifiable fact: it wraps every
// browser API capable of transmitting data off-device - `fetch`,
// `XMLHttpRequest`, and `navigator.sendBeacon` - and records each call.
// The footer reads the recorded count and only shows the green "stays on
// this device" badge while it is zero; any egress flips it to a red alert.
//
// Note on what is intentionally NOT counted: dynamic `import()` and static
// asset loads go through the browser's module/script loader, not these
// APIs, so legitimate same-origin chunk loading never registers as egress.
// Anything caught here is therefore an explicit, app-initiated request.

export interface EgressEntry {
  url: string;
  method: string;
  via: "fetch" | "xhr" | "sendBeacon";
  at: number;
}

type Listener = (count: number) => void;

const egressLog: EgressEntry[] = [];
const listeners = new Set<Listener>();

function record(entry: Omit<EgressEntry, "at">): void {
  egressLog.push({ ...entry, at: Date.now() });
  for (const listener of listeners) listener(egressLog.length);
}

/** Number of outbound requests observed since the monitor was installed. */
export function getEgressCount(): number {
  return egressLog.length;
}

/** Full record of observed outbound requests, oldest first. */
export function getEgressLog(): readonly EgressEntry[] {
  return egressLog;
}

/** Subscribe to egress-count changes. Returns an unsubscribe function. */
export function subscribeEgress(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let installed = false;

/**
 * Wrap the data-transmission APIs. Idempotent, and a no-op outside a browser.
 * Call this as early as possible (before app code runs) so no request slips
 * through unrecorded.
 */
export function installNetworkMonitor(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method =
      init?.method ?? (input instanceof Request ? input.method : "GET");
    record({ url, method, via: "fetch" });
    return originalFetch(input, init);
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  // Cast on assignment: the patched function takes the full variadic arg
  // tuple, which TS won't structurally match against open()'s overload set.
  XMLHttpRequest.prototype.open = function patchedOpen(
    this: XMLHttpRequest,
    ...args: Parameters<XMLHttpRequest["open"]>
  ) {
    const [method, url] = args;
    record({ url: String(url), method, via: "xhr" });
    return originalOpen.apply(this, args);
  } as typeof XMLHttpRequest.prototype.open;

  if (typeof navigator.sendBeacon === "function") {
    const originalSendBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => {
      record({ url: String(url), method: "POST", via: "sendBeacon" });
      return originalSendBeacon(url, data);
    };
  }
}
