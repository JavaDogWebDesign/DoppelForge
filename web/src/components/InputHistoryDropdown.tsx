import { createPortal } from "react-dom";
import { History, Trash2, X } from "lucide-react";
import {
  HISTORY_MAX_ENTRY_CHARS,
  type InputHistoryEntry,
  type RetentionMode,
} from "../hooks/useInputHistory";
import { usePortalDropdown } from "../hooks/usePortalDropdown";

interface Props {
  entries: InputHistoryEntry[];
  onRestore: (entry: InputHistoryEntry) => void;
  onClear: () => void;
  onRemove: (id: string) => void;
  retention: RetentionMode;
  onRetentionChange: (mode: RetentionMode) => void;
  /** Current input is above the per-entry char cap; show a "not saved" hint. */
  currentTooLarge?: boolean;
}

const RETENTION_LABELS: Record<RetentionMode, string> = {
  off: "Off (in-memory only)",
  "1h": "Keep for 1 hour",
  "24h": "Keep for 24 hours",
  persistent: "Keep until cleared",
};

const RETENTION_HINTS: Record<RetentionMode, string> = {
  off: "Not saved - cleared on refresh",
  "1h": "Auto-clears 1 hour after paste",
  "24h": "Auto-clears 24 hours after paste",
  persistent: "Kept until you clear it",
};

function relativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  return `${d}d ago`;
}

function formatSize(chars: number): string {
  if (chars < 1024) return `${chars}B`;
  return `${(chars / 1024).toFixed(1)}KB`;
}

export function InputHistoryDropdown({
  entries,
  onRestore,
  onClear,
  onRemove,
  retention,
  onRetentionChange,
  currentTooLarge,
}: Props) {
  const { open, setOpen, toggle, anchorRef, panelRef, coords } =
    usePortalDropdown<HTMLButtonElement, HTMLDivElement>();

  return (
    <div className="history-dropdown">
      <button
        ref={anchorRef}
        onClick={toggle}
        title={entries.length === 0 ? "History settings" : "Recent inputs"}
        // Accessible name must contain the visible "History" label (WCAG 2.5.3
        // Label in Name); kept explicit so the icon-only state below 1300px,
        // where .btn-label is hidden, still has a name.
        aria-label="History"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <History size={14} />
        <span className="btn-label">History</span>
        {entries.length > 0 && (
          <span className="history-badge">{entries.length}</span>
        )}
      </button>
      {open && coords &&
        createPortal(
          <div
            ref={panelRef}
            className="history-panel"
            role="menu"
            style={{ position: "fixed", top: coords.top, right: coords.right }}
          >
            <div className="history-panel-header">
              <span>Recent inputs</span>
              {entries.length > 0 && (
                <button
                  onClick={() => {
                    onClear();
                    setOpen(false);
                  }}
                  title="Clear all history"
                  aria-label="Clear history"
                >
                  <Trash2 size={11} />
                  Clear all
                </button>
              )}
            </div>
            <div className="history-retention-row">
              <label htmlFor="history-retention-select" className="history-retention-label">
                Retention
              </label>
              <select
                id="history-retention-select"
                className="history-retention-select"
                value={retention}
                onChange={(e) => onRetentionChange(e.target.value as RetentionMode)}
              >
                {(Object.keys(RETENTION_LABELS) as RetentionMode[]).map((mode) => (
                  <option key={mode} value={mode}>
                    {RETENTION_LABELS[mode]}
                  </option>
                ))}
              </select>
            </div>
            <div className="history-retention-hint">{RETENTION_HINTS[retention]}</div>
            {currentTooLarge && retention !== "off" && (
              <div className="history-too-large" role="status">
                Current paste is over {Math.round(HISTORY_MAX_ENTRY_CHARS / 1000)}K chars - not saved to history.
              </div>
            )}
            {entries.length === 0 ? (
              <div className="history-empty">No saved inputs yet.</div>
            ) : (
              <ul className="history-list">
                {entries.map((entry) => (
                  <li key={entry.id} className="history-item">
                    <button
                      className="history-item-main"
                      onClick={() => {
                        onRestore(entry);
                        setOpen(false);
                      }}
                      title="Restore this input"
                    >
                      <span className="history-item-preview">{entry.preview}</span>
                      <span className="history-item-meta">
                        {relativeTime(entry.timestamp)} · {formatSize(entry.charCount)}
                      </span>
                    </button>
                    <button
                      className="history-item-remove"
                      onClick={() => onRemove(entry.id)}
                      title="Remove from history"
                      aria-label="Remove entry"
                    >
                      <X size={11} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
