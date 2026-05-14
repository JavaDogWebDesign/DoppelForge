import { useEffect, useState } from "react";

// Subscribes to a CSS media query and returns whether it currently matches.
// Mirrors the MobileWarning component's inline pattern; extracted so the
// workspace can react to the same breakpoint without re-implementing it.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return matches;
}
