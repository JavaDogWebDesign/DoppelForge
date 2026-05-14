// Lint every provider YAML for parse errors (duplicate keys, bad indent,
// etc.). Mirrors how loader.ts will load them in the browser, so a CI failure
// here means the deployed app would also fail to boot.
//
// Run: node web/scripts/lint-providers.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import yaml from "js-yaml";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const providersDir = join(repoRoot, "providers");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (entry.endsWith(".yaml") || entry.endsWith(".yml")) out.push(full);
  }
  return out;
}

let bad = 0;
const files = walk(providersDir);
for (const file of files) {
  try {
    yaml.load(readFileSync(file, "utf8"));
  } catch (err) {
    bad++;
    console.error(`BAD: ${relative(repoRoot, file)}`);
    console.error(`     ${String(err).split("\n")[0]}`);
  }
}

if (bad > 0) {
  console.error(`\n${bad} of ${files.length} provider YAML file(s) failed to parse.`);
  process.exit(1);
}
console.log(`OK: ${files.length} provider YAML file(s) parsed cleanly.`);
