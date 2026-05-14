import { useEffect, useRef, useState } from "react";
import { safeStorage } from "../utils/safeStorage";

interface Codec<T> {
  parse: (raw: string) => T;
  serialize: (value: T) => string;
}

export function useLocalStorageState<T>(
  key: string,
  fallback: T,
  codec: Codec<T>,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  // Caller may pass a fresh codec object each render (e.g. numberCodec(...)).
  // Pin it so the persist effect doesn't refire and so the parse path is
  // stable across renders.
  const codecRef = useRef(codec);

  const [value, setValue] = useState<T>(() => {
    const raw = safeStorage.get(key);
    if (raw === null) return fallback;
    try {
      return codecRef.current.parse(raw);
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    safeStorage.set(key, codecRef.current.serialize(value));
  }, [key, value]);

  return [value, setValue];
}

export const numberCodec = (clamp?: (n: number) => number): Codec<number> => ({
  parse: (raw) => {
    const n = parseFloat(raw);
    if (!Number.isFinite(n)) throw new Error("not finite");
    return clamp ? clamp(n) : n;
  },
  serialize: (n) => String(n),
});

export const intCodec = (clamp?: (n: number) => number): Codec<number> => ({
  parse: (raw) => {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) throw new Error("not finite");
    return clamp ? clamp(n) : n;
  },
  serialize: (n) => String(n),
});

export const boolCodec: Codec<boolean> = {
  parse: (raw) => raw === "1",
  serialize: (b) => (b ? "1" : "0"),
};

export const stringCodec = <T extends string>(
  isValid: (v: string) => v is T,
): Codec<T> => ({
  parse: (raw) => {
    if (!isValid(raw)) throw new Error("invalid value");
    return raw;
  },
  serialize: (v) => v,
});
