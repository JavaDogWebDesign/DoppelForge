import { useCallback, useEffect, useRef, useState } from "react";
import { safeStorage } from "../utils/safeStorage";

export interface InputHistoryEntry {
  id: string;
  text: string;
  urlHint: string;
  timestamp: number;
  charCount: number;
  preview: string;
}

export type RetentionMode = "off" | "1h" | "24h" | "persistent";

const STORAGE_KEY = "doppelforge.inputHistory";
const RETENTION_KEY = "doppelforge.history.retention";
// Privacy-first default. Real pasted responses sit in localStorage until the
// TTL expires — 1h is long enough to recover from an accidental Reset and
// short enough that an unattended desktop doesn't leak yesterday's payloads.
const DEFAULT_RETENTION: RetentionMode = "1h";
const MAX_ENTRIES = 5;
const MIN_INPUT_CHARS = 50;
const MAX_ENTRY_CHARS = 200_000;
const DEBOUNCE_MS = 1500;
const PRUNE_INTERVAL_MS = 60_000;

// Surfaced to the UI alongside the entry limit so users know the cap exists.
export const HISTORY_MAX_ENTRY_CHARS = MAX_ENTRY_CHARS;

const TTL_MS: Record<"1h" | "24h", number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
};

function isValidMode(v: unknown): v is RetentionMode {
  return v === "off" || v === "1h" || v === "24h" || v === "persistent";
}

function readRetention(): RetentionMode {
  const raw = safeStorage.get(RETENTION_KEY);
  if (isValidMode(raw)) return raw;
  return DEFAULT_RETENTION;
}

function writeRetention(mode: RetentionMode) {
  safeStorage.set(RETENTION_KEY, mode);
}

function filterByTtl(
  entries: InputHistoryEntry[],
  mode: RetentionMode,
): InputHistoryEntry[] {
  if (mode === "persistent" || mode === "off") return entries;
  const cutoff = Date.now() - TTL_MS[mode];
  return entries.filter((e) => e.timestamp >= cutoff);
}

function readStorage(mode: RetentionMode): InputHistoryEntry[] {
  if (mode === "off") return [];
  const raw = safeStorage.get(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const entries = parsed.filter(
      (e): e is InputHistoryEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as InputHistoryEntry).id === "string" &&
        typeof (e as InputHistoryEntry).text === "string",
    );
    return filterByTtl(entries, mode);
  } catch {
    return [];
  }
}

function writeStorage(entries: InputHistoryEntry[], mode: RetentionMode) {
  if (mode === "off") {
    // "off" means in-memory only — make sure nothing lingers on disk.
    safeStorage.remove(STORAGE_KEY);
    return;
  }
  safeStorage.set(STORAGE_KEY, JSON.stringify(entries));
}

function makePreview(text: string): string {
  const stripped = text.trim().replace(/\s+/g, " ");
  return stripped.length > 80 ? stripped.slice(0, 79) + "…" : stripped;
}

export function useInputHistory(text: string, urlHint: string) {
  const [retention, setRetentionState] = useState<RetentionMode>(readRetention);
  const retentionRef = useRef(retention);
  useEffect(() => {
    retentionRef.current = retention;
  }, [retention]);

  const [entries, setEntries] = useState<InputHistoryEntry[]>(() =>
    readStorage(retention),
  );
  const lastSavedTextRef = useRef<string>("");

  // Debounce: only save when the input has been stable long enough to look
  // like a real paste, not mid-typing churn. Requires non-trivial size too.
  useEffect(() => {
    if (text.length < MIN_INPUT_CHARS) return;
    if (text.length > MAX_ENTRY_CHARS) return;
    if (text === lastSavedTextRef.current) return;

    const handle = window.setTimeout(() => {
      setEntries((prev) => {
        // Don't duplicate the most recent entry, even after a rerender.
        if (prev[0]?.text === text && prev[0]?.urlHint === urlHint) return prev;
        const entry: InputHistoryEntry = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          text,
          urlHint,
          timestamp: Date.now(),
          charCount: text.length,
          preview: makePreview(text),
        };
        // Drop any older copy of identical text to keep the list compact.
        const deduped = prev.filter((e) => e.text !== text);
        const next = [entry, ...deduped].slice(0, MAX_ENTRIES);
        writeStorage(next, retentionRef.current);
        lastSavedTextRef.current = text;
        return next;
      });
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(handle);
  }, [text, urlHint]);

  // Periodically prune expired entries while a TTL mode is active so the
  // dropdown reflects reality without waiting for the next render trigger.
  useEffect(() => {
    if (retention === "persistent" || retention === "off") return;
    const handle = window.setInterval(() => {
      setEntries((prev) => {
        const filtered = filterByTtl(prev, retention);
        if (filtered.length === prev.length) return prev;
        writeStorage(filtered, retention);
        return filtered;
      });
    }, PRUNE_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, [retention]);

  const setRetention = useCallback((next: RetentionMode) => {
    setRetentionState(next);
    writeRetention(next);
    // Re-filter current entries against the new mode and rewrite storage so
    // switching to "off" truly wipes disk, and switching to a shorter TTL
    // immediately drops entries that are already past it.
    setEntries((prev) => {
      const filtered = filterByTtl(prev, next);
      writeStorage(filtered, next);
      return filtered;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setEntries([]);
    writeStorage([], retentionRef.current);
  }, []);

  const removeEntry = useCallback((id: string) => {
    setEntries((prev) => {
      const next = prev.filter((e) => e.id !== id);
      writeStorage(next, retentionRef.current);
      return next;
    });
  }, []);

  // True when the current input is over the persistence cap. Lets the UI
  // tell the user their paste was too large to be saved, instead of silently
  // dropping it and leaving them to wonder.
  const currentTooLarge =
    retention !== "off" && text.length > MAX_ENTRY_CHARS;

  return {
    entries,
    clearHistory,
    removeEntry,
    retention,
    setRetention,
    currentTooLarge,
  };
}
