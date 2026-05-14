import { useEffect, useState } from "react";
import { safeStorage } from "../utils/safeStorage";

const QUERY = "(max-width: 1100px)";
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
          This tool's three-panel layout is built for a desktop with horizontal space. The
          tablet / mobile view stacks the panels vertically and tucks the provider list into
          a hamburger menu, but it's still pretty cramped.
        </p>
        <p className="mobile-warning-hint">
          For the best experience, open this page on a laptop or desktop browser.
        </p>
        <button type="button" className="mobile-warning-continue" onClick={handleContinue}>
          Continue anyway
        </button>
      </div>
    </div>
  );
}
