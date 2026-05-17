import { useCallback, useMemo, useState } from "react";
import { ChevronRight, ChevronDown, Search, X, Copy, Check } from "lucide-react";
import type {
  RedactionTarget,
  TargetSection,
  HarOverrides,
  HarOverrideRule,
  RedactionPolicy,
} from "../../engine/har";
import {
  SECTIONS,
  MAX_GROUPS_PER_SECTION,
  MAX_VALUES_PER_GROUP,
  intendedRedact,
  overrideFor,
  type NameGroup,
} from "./shared";

type OnSet = (id: string, rule: HarOverrideRule | null) => void;

function matchesQuery(t: RedactionTarget, q: string): boolean {
  return (
    t.name.toLowerCase().includes(q) ||
    t.original.toLowerCase().includes(q) ||
    t.replacement.toLowerCase().includes(q)
  );
}

/** Groups with anything redacted-by-default sort first, then by name. */
function groupSort(a: NameGroup, b: NameGroup): number {
  const ar = a.targets.some((t) => t.redactedByDefault) ? 0 : 1;
  const br = b.targets.some((t) => t.redactedByDefault) ? 0 : 1;
  return ar - br || a.name.localeCompare(b.name);
}

/** The whole-HAR review surface: a searchable, collapsible tree of every
 *  changeable value, grouped by section then name. */
export function ValueTree({
  targets,
  overrides,
  policy,
  onSet,
}: {
  targets: RedactionTarget[];
  overrides: HarOverrides;
  policy: RedactionPolicy;
  onSet: OnSet;
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

  // A stable key for *which* targets are overridden. Typing in a custom-value
  // input changes `overrides` identity but not this key, so the grouping below
  // isn't rebuilt on every keystroke.
  const overriddenKey = useMemo(
    () => Object.keys(overrides).sort().join("\n"),
    [overrides],
  );

  const hiddenCount = useMemo(() => {
    const ids = new Set(overriddenKey ? overriddenKey.split("\n") : []);
    return targets.filter((t) => !(t.redactedByDefault || ids.has(t.id))).length;
  }, [targets, overriddenKey]);

  // section -> sorted name groups. Default view = flagged values only (redacted
  // by default or touched by the user); search always spans everything.
  const sections = useMemo(() => {
    const ids = new Set(overriddenKey ? overriddenKey.split("\n") : []);
    const bySection = new Map<TargetSection, Map<string, NameGroup>>();
    for (const t of targets) {
      const flagged = t.redactedByDefault || ids.has(t.id);
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
    const sorted = new Map<TargetSection, NameGroup[]>();
    for (const [section, groups] of bySection) {
      sorted.set(section, [...groups.values()].sort(groupSort));
    }
    return sorted;
  }, [targets, q, searching, showUntouched, overriddenKey]);

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
    groups: sections.get(s.section) ?? [],
  })).filter((s) => s.groups.length > 0);

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
            groups={groups}
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
  onSet: OnSet;
}) {
  const { redactedCount, redactedNames } = useMemo(() => {
    let count = 0;
    const names: string[] = [];
    for (const g of groups) {
      const n = g.targets.filter((t) => intendedRedact(t, overrides)).length;
      count += n;
      if (n > 0) names.push(g.name);
    }
    return { redactedCount: count, redactedNames: names };
  }, [groups, overrides]);

  const shown = groups.slice(0, MAX_GROUPS_PER_SECTION);
  const peek = redactedNames.slice(0, 4).join(", ");
  const peekMore = redactedNames.length > 4 ? ` +${redactedNames.length - 4}` : "";

  return (
    <div className={`har-sec${categoryOn ? "" : " off"}`}>
      <button className="har-sec-head" onClick={onToggleOpen} aria-expanded={open}>
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
                  <TargetRow target={g.targets[0]} overrides={overrides} onSet={onSet} showName />
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
  onSet: OnSet;
}) {
  const redactedN = group.targets.filter((t) => intendedRedact(t, overrides)).length;
  const allOn = redactedN === group.targets.length;
  const anyOn = redactedN > 0;

  // The group checkbox flips every child value to one state.
  const toggleAll = () => {
    const next = !anyOn;
    for (const t of group.targets) {
      onSet(t.id, overrideFor(t, next, overrides[t.id]?.value ?? ""));
    }
  };

  const shown = group.targets.slice(0, MAX_VALUES_PER_GROUP);

  return (
    <li className="har-group">
      {/* Whole head toggles collapse; the select-all checkbox stops the click
          from bubbling so it keeps its own behavior. */}
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
          {shown.map((t) => (
            <li key={t.id}>
              <TargetRow target={t} overrides={overrides} onSet={onSet} showName={false} />
            </li>
          ))}
          {group.targets.length > shown.length && (
            <li className="har-sec-more">
              …and {group.targets.length - shown.length} more values — use search.
            </li>
          )}
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
  onSet: OnSet;
  showName: boolean;
}) {
  const [showWhere, setShowWhere] = useState(false);
  const redact = intendedRedact(target, overrides);
  const customValue = overrides[target.id]?.value ?? "";
  const overridden = overrides[target.id] !== undefined;

  const toggle = () => onSet(target.id, overrideFor(target, !redact, customValue));
  const setValue = (v: string) => {
    if (v === "") onSet(target.id, overrideFor(target, redact, ""));
    else onSet(target.id, { redact: true, value: v });
  };

  // What the value becomes if the HAR is re-run with the current selection.
  const preview = redact ? customValue || target.replacement : null;
  const moreLocs = target.occurrences - target.locations.length;

  return (
    <div className="har-row-wrap">
      {/* Whole row toggles the entry list; the checkbox and custom-value input
          stop the click from bubbling so they keep their own behavior. */}
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
            <span className="har-row-orig" title={target.original}>
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
        <div className="har-detail">
          <dl className="har-detail-vals">
            <div className="har-detail-row">
              <dt>Original</dt>
              <dd>
                <code className="har-detail-val">{target.original}</code>
                <CopyButton text={target.original} />
              </dd>
            </div>
            <div className="har-detail-row">
              <dt>{redact ? "Replacement" : "Output"}</dt>
              <dd>
                {redact && preview !== null ? (
                  <>
                    <code className="har-detail-val">{preview}</code>
                    <CopyButton text={preview} />
                  </>
                ) : (
                  <span className="har-row-kept">kept — left as-is</span>
                )}
              </dd>
            </div>
            <div className="har-detail-row">
              <dt>Why</dt>
              <dd className="har-detail-why">{target.reason}</dd>
            </div>
          </dl>
          <div className="har-detail-uses">
            Used in {target.occurrences} {target.occurrences === 1 ? "place" : "places"}
          </div>
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
        </div>
      )}
    </div>
  );
}

/** Copies a value to the clipboard, with a brief confirmation tick. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="har-copy"
      title="Copy"
      aria-label="Copy value"
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
    </button>
  );
}
