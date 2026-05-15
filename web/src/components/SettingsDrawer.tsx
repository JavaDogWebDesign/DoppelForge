import { useCallback, useState, useSyncExternalStore } from "react";
import { ShieldAlert, ShieldX, Trash2 } from "lucide-react";
import { safeStorage, STORAGE_NAMESPACE } from "../utils/safeStorage";
import { getEgressCount, subscribeEgress } from "../utils/networkMonitor";

interface Props {
  cacheSize: number;
  seed: number;
  onClearCache: () => void;
}

export function SettingsDrawer({ cacheSize, seed, onClearCache }: Props) {
  const [confirming, setConfirming] = useState(false);

  // Live count of outbound requests seen by the network monitor. Zero means
  // nothing has left this device, so the privacy badge can say so honestly.
  const egressCount = useSyncExternalStore(subscribeEgress, getEgressCount);
  const dataStaysLocal = egressCount === 0;

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
      {dataStaysLocal ? (
        <span
          className="setting-item privacy-note"
          title="Verified: no outbound network requests have been made - your data has not left this device"
        >
          ● Data stays on this device
        </span>
      ) : (
        <span
          className="setting-item privacy-note privacy-note-alert"
          title={`${egressCount} outbound network request${
            egressCount === 1 ? "" : "s"
          } detected this session`}
        >
          <ShieldAlert size={14} />
          {egressCount} outbound request{egressCount === 1 ? "" : "s"} detected
        </span>
      )}
    </footer>
  );
}
