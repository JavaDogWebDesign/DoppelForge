import { useCallback, useState } from "react";
import { ShieldX, Trash2 } from "lucide-react";
import { safeStorage, STORAGE_NAMESPACE } from "../utils/safeStorage";

interface Props {
  cacheSize: number;
  seed: number;
  onClearCache: () => void;
}

export function SettingsDrawer({ cacheSize, seed, onClearCache }: Props) {
  const [confirming, setConfirming] = useState(false);

  const handleForgetEverything = useCallback(() => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    // Wipe every key this app owns. Includes pasted-response history,
    // per-endpoint field overrides + custom literals, and UI preferences.
    // A reload follows so all in-memory state agrees with the now-empty
    // storage; otherwise the user would see preferences they no longer
    // have backing in localStorage and overrides still in React state.
    safeStorage.removeWithPrefix(STORAGE_NAMESPACE);
    window.location.reload();
  }, [confirming]);

  return (
    <footer className="settings-bar">
      <span className="setting-item">
        Seed: <code>0x{seed.toString(16).padStart(8, "0")}</code>
      </span>
      <span className="setting-item">Cache: {cacheSize} entries</span>
      <button onClick={onClearCache} disabled={cacheSize === 0}>
        <Trash2 size={14} />
        Clear cache
      </button>
      <button
        onClick={handleForgetEverything}
        onBlur={() => setConfirming(false)}
        className={`forget-everything${confirming ? " confirming" : ""}`}
        title="Wipe history, overrides, and UI preferences from this browser"
      >
        <ShieldX size={14} />
        {confirming ? "Click again to confirm" : "Forget everything"}
      </button>
      <span className="setting-item privacy-note">
        ● Data stays on this device
      </span>
    </footer>
  );
}
