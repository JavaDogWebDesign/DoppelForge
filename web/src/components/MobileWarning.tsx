import { useEffect, useState } from "react";
import { safeStorage } from "../utils/safeStorage";

const QUERY = "(max-width: 1200px)";
const DISMISSED_KEY = "doppelforge.mobileWarning.dismissed";

export function MobileWarning() {
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(QUERY).matches,
  );
  const [dismissed, setDismissed] = useState<boolean>(
    () => safeStorage.get(DISMISSED_KEY) === "1",
  );

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const handler = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  if (!isNarrow || dismissed) return null;

  const handleContinue = () => {
    safeStorage.set(DISMISSED_KEY, "1");
    setDismissed(true);
  };

  return (
    <div className="mobile-warning" role="dialog" aria-modal="true" aria-labelledby="mobile-warning-title">
      <div className="mobile-warning-card">
        <h2 id="mobile-warning-title">Best viewed on desktop</h2>
        <p>
          This tool uses a multi-panel layout with side-by-side code editors and a field
          controls panel. It's very hard to use on a small screen.
        </p>
        <p className="mobile-warning-hint">
          For the best experience, please open this page on a desktop or laptop browser.
        </p>
        <button type="button" className="mobile-warning-continue" onClick={handleContinue}>
          Continue anyway
        </button>
      </div>
    </div>
  );
}
