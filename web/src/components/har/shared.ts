import { KeyRound, Link2, Braces, Server, type LucideIcon } from "lucide-react";
import type {
  RedactionPolicy,
  RedactionTarget,
  TargetSection,
  HarOverrides,
  HarOverrideRule,
} from "../../engine/har";

/** Accepted file extensions for the HAR dropzone. */
export const HAR_EXT = /\.(har|json)$/i;

/** A HAR with thousands of body fields would otherwise build thousands of DOM
 *  rows. Search reaches whatever these caps hide. */
export const MAX_GROUPS_PER_SECTION = 250;
export const MAX_VALUES_PER_GROUP = 100;

export interface PolicyOption {
  key: keyof RedactionPolicy;
  label: string;
  icon: LucideIcon;
  /** How doppelforge decides — answers "what counts as sensitive here". */
  detects: string;
}

export const POLICY_OPTIONS: PolicyOption[] = [
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

export const SECTIONS: Array<{
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

/** Section → governing policy category, derived from SECTIONS (single source). */
export const SECTION_CATEGORY = Object.fromEntries(
  SECTIONS.map((s) => [s.section, s.category]),
) as Record<TargetSection, keyof RedactionPolicy>;

/** Targets sharing one name (folded for headers) — the tree's name node. */
export interface NameGroup {
  key: string;
  name: string;
  targets: RedactionTarget[];
}

/** Stable signature of a run's settings — lets the UI detect when the on-screen
 *  result is stale because policy or overrides changed since it was produced. */
export function runSignature(policy: RedactionPolicy, overrides: HarOverrides): string {
  const rules = Object.keys(overrides)
    .sort()
    .map((k) => [k, overrides[k].redact, overrides[k].value ?? ""]);
  return JSON.stringify([policy, rules]);
}

/** Live intended decision for a target: the user's override, else the run's
 *  default. (target.redact reflects the *last* run; this reflects edits since.) */
export function intendedRedact(t: RedactionTarget, overrides: HarOverrides): boolean {
  const rule = overrides[t.id];
  return rule ? rule.redact : t.redactedByDefault;
}

/** The override rule for a chosen decision — or null when the choice matches
 *  the built-in default and carries no custom value (so no override is needed). */
export function overrideFor(
  target: RedactionTarget,
  redact: boolean,
  customValue: string,
): HarOverrideRule | null {
  if (redact === target.redactedByDefault && customValue === "") return null;
  return { redact, ...(customValue ? { value: customValue } : {}) };
}
