import { useCallback, useMemo, useRef, useState } from "react";
import {
  Upload,
  Loader,
  Check,
  AlertTriangle,
  Download,
  RotateCcw,
  ChevronRight,
  ChevronDown,
  Search,
  X,
  KeyRound,
  Link2,
  Braces,
  Server,
  type LucideIcon,
} from "lucide-react";
import { useHarObfuscator } from "../hooks/useHarObfuscator";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { checkHarGate } from "../engine/harConstants";
import {
  DEFAULT_POLICY,
  type RedactionPolicy,
  type RedactionTarget,
  type TargetSection,
  type HarOverrides,
  type HarOverrideRule,
} from "../engine/har";
import { downloadBlob } from "../utils/zip";

const HAR_EXT = /\.(har|json)$/i;
// Cap groups rendered per section — a HAR with thousands of body fields would
// otherwise build thousands of DOM rows. Search reaches the rest.
const MAX_GROUPS_PER_SECTION = 250;

interface PolicyOption {
  key: keyof RedactionPolicy;
  label: string;
  icon: LucideIcon;
  /** How doppelforge decides — answers "what counts as sensitive here". */
  detects: string;
}

const POLICY_OPTIONS: PolicyOption[] = [
  {
    key: "headers",
    label: "Auth headers & cookies",
    icon: KeyRound,
    detects: "Credential-named headers and session cookies",
  },
  {
    key: "params",
    label: "Secret URL & form params",
    icon: Link2,
    detects: "Params named token, key, secret, signature, password…",
  },
  {
    key: "bodies",
    label: "Body fields",
    icon: Braces,
    detects: "Emails, names, IDs and other PII inside JSON/XML bodies",
  },
  {
    key: "ips",
    label: "Server IP addresses",
    icon: Server,
    detects: "Each entry's serverIPAddress",
  },
];

/** Maps a target section to the policy category that governs it. */
const SECTION_CATEGORY: Record<TargetSection, keyof RedactionPolicy> = {
  header: "headers",
  cookie: "headers",
  param: "params",
  body: "bodies",
  ip: "ips",
};

const SECTIONS: Array<{
  section: TargetSection;
  title: string;
  category: keyof RedactionPolicy;
}> = [
  { section: "header", title: "Headers", category: "headers" },
  { section: "cookie", title: "Cookies", category: "headers" },
  { section: "param", title: "Query & form params", category: "params" },
  { section: "body", title: "Body fields", category: "bodies" },
  { section: "ip", title: "Server IPs", category: "ips" },
];

/** Targets sharing one name (folded for headers) — the tree's name node. */
interface NameGroup {
  key: string;
  name: string;
  targets: RedactionTarget[];
}

function runSignature(policy: RedactionPolicy, overrides: HarOverrides): string {
  const rules = Object.keys(overrides)
    .sort()
    .map((k) => [k, overrides[k].redact, overrides[k].value ?? ""]);
  return JSON.stringify([policy, rules]);
}

/** Live intended decision for a target: the user's override, else the run's
 *  default. (target.redact reflects the *last* run; this reflects edits since.) */
function intendedRedact(t: RedactionTarget, overrides: HarOverrides): boolean {
  const rule = overrides[t.id];
  return rule ? rule.redact : t.redactedByDefault;
}

export function HarWorkspace() {
  const { state, process, reprocess, reset } = useHarObfuscator();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [dragging, setDragging] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [policy, setPolicy] = useState<RedactionPolicy>(DEFAULT_POLICY);
  const [overrides, setOverrides] = useState<HarOverrides>({});
  const [appliedSig, setAppliedSig] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      setGateError(null);
      setWarning(null);
      if (!HAR_EXT.test(file.name)) {
        setGateError("That doesn't look like a HAR file. Choose a .har file.");
        return;
      }
      const gate = checkHarGate(file.size, isMobile);
      if (gate.kind === "refuse") {
        setGateError(gate.message);
        return;
      }
      if (gate.kind === "warn") setWarning(gate.message);
      setAppliedSig(runSignature(policy, overrides));
      process(file, policy, overrides);
    },
    [isMobile, policy, overrides, process],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const onPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      e.target.value = "";
    },
    [handleFile],
  );

  const handleDownload = useCallback(() => {
    if (state.resultBlob && state.resultName) {
      downloadBlob(state.resultBlob, state.resultName);
    }
  }, [state.resultBlob, state.resultName]);

  const handleReset = useCallback(() => {
    setGateError(null);
    setWarning(null);
    reset();
  }, [reset]);

  const handleRerun = useCallback(() => {
    setAppliedSig(runSignature(policy, overrides));
    reprocess(policy, overrides);
  }, [policy, overrides, reprocess]);

  const togglePolicy = useCallback((key: keyof RedactionPolicy) => {
    setPolicy((p) => ({ ...p, [key]: !p[key] }));
  }, []);

  const setOverride = useCallback((id: string, rule: HarOverrideRule | null) => {
    setOverrides((prev) => {
      const next = { ...prev };
      if (rule === null) delete next[id];
      else next[id] = rule;
      return next;
    });
  }, []);

  const flaggedCount = useMemo(
    () => state.targets.filter((t) => intendedRedact(t, overrides)).length,
    [state.targets, overrides],
  );

  const categoryCounts = useMemo(() => {
    const c: Record<keyof RedactionPolicy, number> = {
      headers: 0,
      params: 0,
      bodies: 0,
      ips: 0,
    };
    for (const t of state.targets) {
      if (intendedRedact(t, overrides)) c[SECTION_CATEGORY[t.section]]++;
    }
    return c;
  }, [state.targets, overrides]);

  const showDropzone = state.phase === "idle" || state.phase === "error";
  const processing = state.phase === "processing";
  const progressPct =
    state.progress && state.progress.total > 0
      ? Math.round((state.progress.done / state.progress.total) * 100)
      : 0;
  const settingsDrifted =
    state.phase === "done" &&
    appliedSig !== null &&
    runSignature(policy, overrides) !== appliedSig;
  const noneSelected = !policy.headers && !policy.params && !policy.bodies && !policy.ips;

  return (
    <div className="workspace har-workspace">
      <div className="har-intro">
        <h2 className="har-intro-title">HAR file obfuscator</h2>
        <p className="har-intro-text">
          Drop a HAR capture — the network log your browser's DevTools exports.
          doppelforge scans every request and response, flags what's sensitive
          (credential headers, session cookies, secret params, server IPs, PII
          in JSON/XML bodies), and shows it as one tree of{" "}
          <em>current value → realistic replacement</em>. Tick what to redact,
          set custom values, drill into where each value is used, then re-run.
          Everything happens in your browser — nothing is uploaded.
        </p>
      </div>

      <PolicyPanel
        policy={policy}
        disabled={processing}
        counts={categoryCounts}
        showCounts={state.phase === "done"}
        onToggle={togglePolicy}
      />

      {showDropzone && (
        <div
          className={`batch-dropzone har-dropzone${dragging ? " dragging" : ""}${noneSelected ? " disabled" : ""}`}
          onDrop={onDrop}
          onDragOver={(e) => {
            e.preventDefault();
            if (!noneSelected) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onClick={() => {
            if (!noneSelected) inputRef.current?.click();
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && !noneSelected) {
              inputRef.current?.click();
            }
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".har,application/json"
            onChange={onPick}
            style={{ display: "none" }}
          />
          <Upload size={20} />
          <span className="batch-dropzone-label">
            {noneSelected
              ? "Turn on at least one redaction category above"
              : "Drop a .har file here, or click to browse"}
          </span>
          <span className="batch-dropzone-hint">
            Processed entirely in your browser — nothing is uploaded.
          </span>
        </div>
      )}

      {gateError && (
        <div className="har-banner har-banner-error" role="alert">
          <AlertTriangle size={14} />
          <span>{gateError}</span>
        </div>
      )}

      {state.phase === "error" && state.error && (
        <div className="har-banner har-banner-error" role="alert">
          <AlertTriangle size={14} />
          <span>Could not process this HAR: {state.error}</span>
        </div>
      )}

      {warning && state.phase !== "idle" && (
        <div className="har-banner har-banner-warn" role="status">
          <AlertTriangle size={14} />
          <span>{warning}</span>
        </div>
      )}

      {processing && (
        <div className="har-progress">
          <div className="har-progress-head">
            <Loader size={14} className="har-spin" />
            <span>
              {state.progress && state.progress.total > 0
                ? `Obfuscating entries — ${state.progress.done} / ${state.progress.total}`
                : "Parsing HAR…"}
            </span>
            <button className="batch-reseed har-progress-cancel" onClick={handleReset}>
              <X size={12} />
              Cancel
            </button>
          </div>
          <div className="har-progress-track">
            <div className="har-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      )}

      {state.phase === "done" && state.stats && (
        <div className="har-result">
          <div className="har-result-head">
            <Check size={16} className="har-result-check" />
            <span>
              {state.stats.entries.toLocaleString()} entries scanned ·{" "}
              <strong>{flaggedCount.toLocaleString()}</strong> value
              {flaggedCount === 1 ? "" : "s"} flagged for obfuscation
            </span>
          </div>

          {settingsDrifted && (
            <div className="har-banner har-banner-warn" role="status">
              <AlertTriangle size={14} />
              <div className="har-rerun-row">
                <span>Selections changed. Re-run to apply them to the HAR.</span>
                <button className="batch-run har-rerun-btn" onClick={handleRerun}>
                  <RotateCcw size={12} />
                  Re-run
                </button>
              </div>
            </div>
          )}

          <ValueTree
            targets={state.targets}
            overrides={overrides}
            policy={policy}
            onSet={setOverride}
          />

          {state.stats.entryErrors.length > 0 && (
            <div className="har-banner har-banner-warn" role="status">
              <AlertTriangle size={14} />
              <div>
                <strong>
                  {state.stats.entryErrors.length} entr
                  {state.stats.entryErrors.length === 1 ? "y" : "ies"} left
                  partly unobfuscated:
                </strong>
                <ul className="har-error-list">
                  {state.stats.entryErrors.slice(0, 5).map((e, i) => (
                    <li key={i}>
                      Entry #{e.entry}: {e.message}
                    </li>
                  ))}
                  {state.stats.entryErrors.length > 5 && (
                    <li>…and {state.stats.entryErrors.length - 5} more.</li>
                  )}
                </ul>
              </div>
            </div>
          )}

          <div className="har-result-actions">
            <button className="batch-run" onClick={handleDownload}>
              <Download size={12} />
              Download {state.resultName}
            </button>
            <button className="batch-reseed" onClick={handleReset}>
              <RotateCcw size={12} />
              Process another
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PolicyPanel({
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

function matchesQuery(t: RedactionTarget, q: string): boolean {
  return (
    t.name.toLowerCase().includes(q) ||
    t.original.toLowerCase().includes(q) ||
    t.replacement.toLowerCase().includes(q)
  );
}

function ValueTree({
  targets,
  overrides,
  policy,
  onSet,
}: {
  targets: RedactionTarget[];
  overrides: HarOverrides;
  policy: RedactionPolicy;
  onSet: (id: string, rule: HarOverrideRule | null) => void;
}) {
  const [query, setQuery] = useState("");
  // Off by default — the benign long tail stays hidden until the user wants to
  // redact something extra.
  const [showUntouched, setShowUntouched] = useState(false);
  // Sections collapsed by default; only the names worth a glance show up front.
  const [openSections, setOpenSections] = useState<Set<TargetSection>>(new Set());
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  const hiddenCount = useMemo(
    () =>
      targets.filter(
        (t) => !(t.redactedByDefault || overrides[t.id] !== undefined),
      ).length,
    [targets, overrides],
  );

  // section -> name groups. Default view = flagged values only (redacted by
  // default or touched by the user). Search always spans everything.
  const sections = useMemo(() => {
    const bySection = new Map<TargetSection, Map<string, NameGroup>>();
    for (const t of targets) {
      const flagged = t.redactedByDefault || overrides[t.id] !== undefined;
      if (searching) {
        if (!matchesQuery(t, q)) continue;
      } else if (!showUntouched && !flagged) {
        continue;
      }
      let groups = bySection.get(t.section);
      if (!groups) {
        groups = new Map();
        bySection.set(t.section, groups);
      }
      const gkey = t.section === "header" ? t.name.toLowerCase() : t.name;
      const g = groups.get(gkey);
      if (g) g.targets.push(t);
      else groups.set(gkey, { key: `${t.section}:${gkey}`, name: t.name, targets: [t] });
    }
    return bySection;
  }, [targets, q, searching, showUntouched, overrides]);

  const toggleSection = useCallback((s: TargetSection) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }, []);
  const toggleGroup = useCallback((key: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  if (targets.length === 0) {
    return (
      <div className="har-changes-empty">
        No redactable values found in this HAR — nothing to change.
      </div>
    );
  }

  const visibleSections = SECTIONS.map((s) => ({
    ...s,
    groups: sections.get(s.section),
  })).filter((s) => s.groups && s.groups.size > 0);

  return (
    <div className="har-tree">
      <div className="har-tree-toolbar">
        <Search size={13} />
        <input
          className="har-tree-search"
          type="text"
          placeholder="Search every value…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button className="har-tree-clear" onClick={() => setQuery("")} aria-label="Clear search">
            <X size={13} />
          </button>
        )}
      </div>

      {visibleSections.length === 0 ? (
        <div className="har-sec-empty">
          {searching ? "No values match your search." : "Nothing flagged for obfuscation."}
        </div>
      ) : (
        visibleSections.map(({ section, title, category, groups }) => (
          <TreeSection
            key={section}
            title={title}
            groups={[...groups!.values()].sort(groupSort)}
            categoryOn={policy[category]}
            overrides={overrides}
            open={searching || openSections.has(section)}
            onToggleOpen={() => toggleSection(section)}
            openGroups={openGroups}
            onToggleGroup={toggleGroup}
            onSet={onSet}
          />
        ))
      )}

      {!searching && hiddenCount > 0 && (
        <label className="har-tree-foot">
          <input
            type="checkbox"
            checked={showUntouched}
            onChange={() => setShowUntouched((v) => !v)}
          />
          Show {hiddenCount.toLocaleString()} value{hiddenCount === 1 ? "" : "s"}{" "}
          left untouched — in case you want to redact something extra
        </label>
      )}
    </div>
  );
}

/** Groups with anything redacted-by-default sort first, then by name. */
function groupSort(a: NameGroup, b: NameGroup): number {
  const ar = a.targets.some((t) => t.redactedByDefault) ? 0 : 1;
  const br = b.targets.some((t) => t.redactedByDefault) ? 0 : 1;
  return ar - br || a.name.localeCompare(b.name);
}

function TreeSection({
  title,
  groups,
  categoryOn,
  overrides,
  open,
  onToggleOpen,
  openGroups,
  onToggleGroup,
  onSet,
}: {
  title: string;
  groups: NameGroup[];
  categoryOn: boolean;
  overrides: HarOverrides;
  open: boolean;
  onToggleOpen: () => void;
  openGroups: Set<string>;
  onToggleGroup: (key: string) => void;
  onSet: (id: string, rule: HarOverrideRule | null) => void;
}) {
  const shown = groups.slice(0, MAX_GROUPS_PER_SECTION);
  const redactedCount = groups.reduce(
    (n, g) => n + g.targets.filter((t) => intendedRedact(t, overrides)).length,
    0,
  );
  // A peek at which names are being redacted, shown on the collapsed header.
  const redactedNames = groups
    .filter((g) => g.targets.some((t) => intendedRedact(t, overrides)))
    .map((g) => g.name);
  const peek = redactedNames.slice(0, 4).join(", ");
  const peekMore = redactedNames.length > 4 ? ` +${redactedNames.length - 4}` : "";

  return (
    <div className={`har-sec${categoryOn ? "" : " off"}`}>
      <button
        className="har-sec-head"
        onClick={onToggleOpen}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="har-sec-title">{title}</span>
        <span className="har-sec-count">{redactedCount} to redact</span>
        {!open && redactedNames.length > 0 && (
          <span className="har-sec-peek">
            {peek}
            {peekMore}
          </span>
        )}
        {!categoryOn && <span className="har-cat-disabled">category off</span>}
      </button>
      {open && (
        <>
          <ul className="har-sec-groups">
            {shown.map((g) =>
              g.targets.length === 1 ? (
                <li key={g.key}>
                  <TargetRow
                    target={g.targets[0]}
                    overrides={overrides}
                    onSet={onSet}
                    showName
                  />
                </li>
              ) : (
                <GroupRow
                  key={g.key}
                  group={g}
                  overrides={overrides}
                  collapsed={!openGroups.has(g.key)}
                  onToggleCollapse={() => onToggleGroup(g.key)}
                  onSet={onSet}
                />
              ),
            )}
          </ul>
          {groups.length > shown.length && (
            <div className="har-sec-more">
              …and {groups.length - shown.length} more — use search to reach them.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function GroupRow({
  group,
  overrides,
  collapsed,
  onToggleCollapse,
  onSet,
}: {
  group: NameGroup;
  overrides: HarOverrides;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSet: (id: string, rule: HarOverrideRule | null) => void;
}) {
  const redactedN = group.targets.filter((t) => intendedRedact(t, overrides)).length;
  const allOn = redactedN === group.targets.length;
  const anyOn = redactedN > 0;

  // Group checkbox flips every child to one state.
  const toggleAll = () => {
    const next = !anyOn;
    for (const t of group.targets) {
      if (next === t.redactedByDefault && overrides[t.id]?.value === undefined) {
        onSet(t.id, null);
      } else {
        const value = overrides[t.id]?.value;
        onSet(t.id, { redact: next, ...(value ? { value } : {}) });
      }
    }
  };

  return (
    <li className="har-group">
      {/* Clicking anywhere on the group head expands/collapses it; the
          select-all checkbox stops propagation to keep its own behavior. */}
      <div
        className="har-group-head"
        onClick={onToggleCollapse}
        role="button"
        aria-expanded={!collapsed}
      >
        <span className="har-group-toggle">
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        </span>
        <input
          type="checkbox"
          checked={allOn}
          ref={(el) => {
            if (el) el.indeterminate = anyOn && !allOn;
          }}
          onChange={toggleAll}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Redact all values of ${group.name}`}
        />
        <span className="har-group-name">{group.name}</span>
        <span className="har-group-count">
          {group.targets.length} distinct values · {redactedN} redacted
        </span>
      </div>
      {!collapsed && (
        <ul className="har-group-children">
          {group.targets.map((t) => (
            <li key={t.id}>
              <TargetRow target={t} overrides={overrides} onSet={onSet} showName={false} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function TargetRow({
  target,
  overrides,
  onSet,
  showName,
}: {
  target: RedactionTarget;
  overrides: HarOverrides;
  onSet: (id: string, rule: HarOverrideRule | null) => void;
  showName: boolean;
}) {
  const redact = intendedRedact(target, overrides);
  const customValue = overrides[target.id]?.value ?? "";
  const overridden = overrides[target.id] !== undefined;

  const toggle = () => {
    const next = !redact;
    if (next === target.redactedByDefault && customValue === "") {
      onSet(target.id, null);
    } else {
      onSet(target.id, { redact: next, ...(customValue ? { value: customValue } : {}) });
    }
  };

  const setValue = (v: string) => {
    if (v === "") {
      if (redact === target.redactedByDefault) onSet(target.id, null);
      else onSet(target.id, { redact });
    } else {
      onSet(target.id, { redact: true, value: v });
    }
  };

  // What the value becomes if the HAR is re-run with the current selection.
  const preview = redact ? customValue || target.replacement : null;
  const [showWhere, setShowWhere] = useState(false);
  const moreLocs = target.occurrences - target.locations.length;

  return (
    <div className="har-row-wrap">
      {/* Clicking anywhere on the row toggles its entry list; the checkbox and
          custom-value input stop propagation so they keep their own behavior. */}
      <div
        className={`har-row${overridden ? " overridden" : ""}`}
        onClick={() => setShowWhere((o) => !o)}
      >
        <input
          type="checkbox"
          checked={redact}
          onChange={toggle}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Redact ${target.name}`}
        />
        <span className="har-row-main">
          {showName && <span className="har-row-name">{target.name}</span>}
          <span
            className={`har-row-reason${redact ? " flagged" : ""}`}
            title="Why doppelforge flagged this"
          >
            {target.reason}
          </span>
          <span className="har-row-values">
            <span
              className={`har-row-orig${preview !== null ? " struck" : ""}`}
              title={target.original}
            >
              {target.original}
            </span>
            {preview !== null ? (
              <>
                <span className="har-arrow">→</span>
                <span className="har-row-new" title={preview}>
                  {preview}
                </span>
              </>
            ) : (
              <span className="har-row-kept">kept</span>
            )}
          </span>
        </span>
        <span className={`har-row-uses${showWhere ? " open" : ""}`}>
          {showWhere ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          {target.occurrences} {target.occurrences === 1 ? "use" : "uses"}
        </span>
        <input
          className="har-row-custom"
          type="text"
          value={customValue}
          disabled={!redact}
          placeholder="custom value"
          onChange={(e) => setValue(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Custom value for ${target.name}`}
        />
      </div>
      {showWhere && (
        <ul className="har-locs">
          {target.locations.map((l, i) => (
            <li key={i} className="har-loc">
              <span className="har-loc-entry">entry #{l.entry}</span>
              {l.method && <span className="har-loc-method">{l.method}</span>}
              <span className="har-loc-url" title={l.url}>
                {l.url || "—"}
              </span>
            </li>
          ))}
          {moreLocs > 0 && (
            <li className="har-loc-more">
              +{moreLocs} more occurrence{moreLocs === 1 ? "" : "s"}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
