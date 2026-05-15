import { describe, it, expect, beforeEach } from "vitest";
import {
  addCustomProvider,
  loadStoredSources,
  parseCustomProvider,
  totalSourceBytes,
  type CustomProviderSource,
} from "./customProviders";

// customProviders.ts persists to localStorage and short-circuits to a no-op
// when it is undefined. The test runner uses the `node` environment (no DOM),
// so install a minimal in-memory stand-in before exercising the storage path.
function installFakeLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

function manifest(id: string, name: string): string {
  return [
    `id: ${id}`,
    `name: ${name}`,
    "category: internal",
    "icon: database",
    'color: "#6366F1"',
    "docs: https://example.com/docs",
    "",
  ].join("\n");
}

const ENDPOINT = [
  "endpoint:",
  "  method: GET",
  "  path: /api/v1/thing/{id}",
  "fields:",
  '  "id": { type: id, anchor: true }',
  "",
].join("\n");

function source(id: string, name: string): CustomProviderSource {
  return { manifestYaml: manifest(id, name), endpointYamls: { thing: ENDPOINT } };
}

const NO_BUILT_INS = new Set<string>();

describe("addCustomProvider", () => {
  beforeEach(() => {
    installFakeLocalStorage();
  });

  it("appends a second provider instead of overwriting the first", () => {
    const a = addCustomProvider(source("prov-a", "Provider A"), NO_BUILT_INS);
    expect(a.ok).toBe(true);

    const b = addCustomProvider(source("prov-b", "Provider B"), NO_BUILT_INS);
    expect(b.ok).toBe(true);

    // The reported bug: saving B used to drop A. Both must survive.
    const stored = loadStoredSources();
    expect(stored.map((s) => s.manifestYaml).join("\n")).toContain("id: prov-a");
    expect(stored.map((s) => s.manifestYaml).join("\n")).toContain("id: prov-b");
    expect(stored).toHaveLength(2);
  });

  it("rejects a new provider whose id collides with an existing one", () => {
    addCustomProvider(source("prov-a", "Provider A"), NO_BUILT_INS);

    // replaceId omitted -> this is an "add new", not an edit.
    const dup = addCustomProvider(source("prov-a", "Different Name"), NO_BUILT_INS);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toContain("already exists");

    // The original A is untouched - no silent overwrite.
    const stored = loadStoredSources();
    expect(stored).toHaveLength(1);
    expect(stored[0].manifestYaml).toContain("name: Provider A");
  });

  it("allows an explicit edit (replaceId) to overwrite the same id", () => {
    addCustomProvider(source("prov-a", "Provider A"), NO_BUILT_INS);

    const edited = addCustomProvider(
      source("prov-a", "Provider A Renamed"),
      NO_BUILT_INS,
      "prov-a",
    );
    expect(edited.ok).toBe(true);

    const stored = loadStoredSources();
    expect(stored).toHaveLength(1);
    expect(stored[0].manifestYaml).toContain("name: Provider A Renamed");
  });

  it("lets an edit change the provider id without leaving a stale copy", () => {
    addCustomProvider(source("prov-a", "Provider A"), NO_BUILT_INS);

    // Edit prov-a, renaming its id to prov-a2.
    const edited = addCustomProvider(
      source("prov-a2", "Provider A"),
      NO_BUILT_INS,
      "prov-a",
    );
    expect(edited.ok).toBe(true);

    const stored = loadStoredSources();
    expect(stored).toHaveLength(1);
    expect(stored[0].manifestYaml).toContain("id: prov-a2");
  });
});

// ----- Validation / security boundary -----
// Custom-provider YAML is the one real untrusted-input surface in the app.
// These cover pollution keys, CSS injection through the accent color, the
// size caps, the semantic-type vocabulary, and js-yaml's safe schema.

const VALID_MANIFEST_YAML = [
  "id: my-test-provider",
  "name: My Test Provider",
  "category: Testing",
  "icon: Box",
  'color: "#3366cc"',
  "docs: https://example.test/docs",
].join("\n");

const VALID_ENDPOINT_YAML = [
  "endpoint:",
  "  method: GET",
  "  path: /v1/things/{id}",
  "signature:",
  "  required_paths:",
  "    - id",
  "fields:",
  '  "id": { type: id }',
  '  "email": { type: email }',
].join("\n");

function mkSource(
  manifestYaml: string,
  endpointYamls: Record<string, string> = { "thing-get": VALID_ENDPOINT_YAML },
): CustomProviderSource {
  return { manifestYaml, endpointYamls };
}

describe("parseCustomProvider — accepts valid input", () => {
  it("parses a well-formed manifest and endpoint", () => {
    const parsed = parseCustomProvider(mkSource(VALID_MANIFEST_YAML));
    expect(parsed.provider.manifest.id).toBe("my-test-provider");
    expect(parsed.provider.endpoints).toHaveLength(1);
    expect(parsed.provider.endpoints[0].fields.email.type).toBe("email");
  });
});

describe("parseCustomProvider — rejects unsafe input", () => {
  it("rejects a prototype-pollution key in the manifest", () => {
    expect(() =>
      parseCustomProvider(
        mkSource(`${VALID_MANIFEST_YAML}\n__proto__: { polluted: true }`),
      ),
    ).toThrow(/forbidden key/);
  });

  it("rejects a prototype-pollution key in an endpoint's fields block", () => {
    const ep = VALID_ENDPOINT_YAML.replace(
      '  "id": { type: id }',
      '  "__proto__": { type: id }\n  "id": { type: id }',
    );
    expect(() =>
      parseCustomProvider(mkSource(VALID_MANIFEST_YAML, { "thing-get": ep })),
    ).toThrow(/forbidden key/);
  });

  it("rejects a CSS-injection payload in the accent color", () => {
    // color is interpolated into a CSS custom property; a ';' would let a
    // shared provider close the declaration and inject arbitrary rules.
    const manifest = VALID_MANIFEST_YAML.replace(
      'color: "#3366cc"',
      'color: "#fff;}body{display:none}"',
    );
    expect(() => parseCustomProvider(mkSource(manifest))).toThrow(/hex value/);
  });

  it("rejects a non-hex color", () => {
    const manifest = VALID_MANIFEST_YAML.replace(
      'color: "#3366cc"',
      "color: rebeccapurple",
    );
    expect(() => parseCustomProvider(mkSource(manifest))).toThrow(/hex value/);
  });

  it("rejects an invalid provider id", () => {
    const manifest = VALID_MANIFEST_YAML.replace(
      "id: my-test-provider",
      'id: "My Provider!"',
    );
    expect(() => parseCustomProvider(mkSource(manifest))).toThrow(/id/);
  });

  it("rejects a missing required manifest field", () => {
    const manifest = VALID_MANIFEST_YAML.split("\n")
      .filter((l) => !l.startsWith("name:"))
      .join("\n");
    expect(() => parseCustomProvider(mkSource(manifest))).toThrow(/name/);
  });

  it("rejects a field rule with an unknown semantic type", () => {
    const ep = VALID_ENDPOINT_YAML.replace("{ type: email }", "{ type: emial }");
    expect(() =>
      parseCustomProvider(mkSource(VALID_MANIFEST_YAML, { "thing-get": ep })),
    ).toThrow(/semantic vocabulary/);
  });

  it("rejects a YAML document over the 200KB per-file cap", () => {
    const huge = `${VALID_MANIFEST_YAML}\n# ${"x".repeat(200_001)}`;
    expect(() => parseCustomProvider(mkSource(huge))).toThrow(/200KB/);
  });

  it("does not deserialize non-JSON-schema YAML tags", () => {
    // js-yaml v4 under JSON_SCHEMA has no js/* types and rejects unknown tags,
    // so there is no code-execution path through a custom provider.
    const manifest = VALID_MANIFEST_YAML.replace(
      "id: my-test-provider",
      "id: !!js/function 'function(){}'",
    );
    expect(() => parseCustomProvider(mkSource(manifest))).toThrow();
  });
});

describe("addCustomProvider — collision and size limits", () => {
  beforeEach(() => {
    installFakeLocalStorage();
  });

  it("rejects a provider whose id collides with a built-in provider", () => {
    const result = addCustomProvider(
      mkSource(VALID_MANIFEST_YAML),
      new Set(["my-test-provider"]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/reserved/);
  });

  it("rejects a provider that pushes total custom storage past the 1MB cap", () => {
    // Each endpoint stays under the 200KB per-file cap; six of them clear 1MB.
    const padded = `${VALID_ENDPOINT_YAML}\n# ${"p".repeat(190_000)}`;
    const endpointYamls: Record<string, string> = {};
    for (let i = 0; i < 6; i++) endpointYamls[`thing-${i}`] = padded;
    const result = addCustomProvider(
      mkSource(VALID_MANIFEST_YAML, endpointYamls),
      new Set(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/1MB|cap/);
  });
});

describe("totalSourceBytes", () => {
  it("sums manifest and endpoint YAML sizes plus slug lengths", () => {
    const src: CustomProviderSource = { manifestYaml: "manifest", endpointYamls: { ab: "xy" } };
    // "manifest" (8) + slug "ab" (2) + "xy" (2) = 12
    expect(totalSourceBytes([src])).toBe(12);
  });
});
