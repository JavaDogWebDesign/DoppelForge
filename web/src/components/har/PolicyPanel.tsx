import type { RedactionPolicy } from "../../engine/har";
import { POLICY_OPTIONS } from "./shared";

/** The four redaction categories as toggle cards — the master switches above
 *  the value tree, with a per-category flagged count once a HAR is processed. */
export function PolicyPanel({
  policy,
  disabled,
  counts,
  showCounts,
  onToggle,
}: {
  policy: RedactionPolicy;
  disabled: boolean;
  counts: Record<keyof RedactionPolicy, number>;
  showCounts: boolean;
  onToggle: (key: keyof RedactionPolicy) => void;
}) {
  return (
    <div className="har-cats">
      <div className="har-cats-head">What doppelforge looks for</div>
      <div className="har-cats-grid">
        {POLICY_OPTIONS.map((opt) => {
          const on = policy[opt.key];
          const Icon = opt.icon;
          return (
            <label
              key={opt.key}
              className={`har-cat-card${on ? " on" : ""}${disabled ? " disabled" : ""}`}
            >
              <Icon size={15} className="har-cat-ico" />
              <span className="har-cat-text">
                <span className="har-cat-top">
                  <span className="har-cat-name">{opt.label}</span>
                  {showCounts && (
                    <span className={`har-cat-n${on ? " on" : ""}`}>
                      {on ? `${counts[opt.key].toLocaleString()} flagged` : "skipped"}
                    </span>
                  )}
                </span>
                <span className="har-cat-desc">{opt.detects}</span>
              </span>
              <input
                type="checkbox"
                className="har-cat-input"
                checked={on}
                disabled={disabled}
                onChange={() => onToggle(opt.key)}
              />
              <span className="har-switch" aria-hidden="true" />
            </label>
          );
        })}
      </div>
    </div>
  );
}
