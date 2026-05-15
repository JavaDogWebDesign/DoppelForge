import { XMLParser, XMLBuilder } from "fast-xml-parser";
import type { JsonValue } from "./types";

export type InputFormat = "json" | "xml" | "form" | "csv" | "ndjson";
export type CsvDelimiter = "," | "\t" | ";";

export interface ParsedInput {
  data: JsonValue;
  format: InputFormat;
  rootName?: string;
  // Original key order from a urlencoded body - re-emitted on serialize so
  // the round-trip diff stays meaningful. Only present when format === "form"
  // and the body was a flat Twilio-style key/value pair.
  formOrder?: string[];
  // Distinguishes the three Braintree paste shapes so serialize() can wrap
  // back to whatever the user pasted. Null for Twilio.
  //   "form"   - outer bt_signature=&bt_payload=<base64 XML>
  //   "base64" - bare base64 XML (rare; not auto-detected in v1)
  //   "xml"    - decoded XML pasted directly (detected as format: "xml", not "form")
  braintreeWrapper?: "form" | "base64" | "xml" | null;
  // CSV round-trip state - original column order + delimiter + line ending so
  // the obfuscated output matches the user's input shape byte-for-byte where
  // possible (preserves diffability and Excel/Sheets re-import).
  csvHeaders?: string[];
  csvDelimiter?: CsvDelimiter;
  csvLineEnding?: "\n" | "\r\n";
}

export function detectFormat(input: string): InputFormat | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("<")) return "xml";
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    // Could be plain JSON or NDJSON. NDJSON has multiple non-empty lines that
    // each parse as a standalone JSON value. Pretty-printed JSON arrays have
    // intermediate lines starting with `}`/`]`/space, which fail the prefix
    // check below and fall through to plain JSON.
    const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length >= 2 && lines.every((l) => /^[[{"]/.test(l.trim()))) {
      try {
        JSON.parse(lines[0]);
        JSON.parse(lines[1]);
        return "ndjson";
      } catch {
        /* fall through to plain JSON */
      }
    }
    return "json";
  }
  // Bare base64 - pure base64 alphabet, no `&`, length large enough to be a
  // Braintree bt_payload (which is base64-encoded XML, typically 500+ chars).
  // Check before the form-pair regex so short base64 padding chars don't get
  // mistaken for a `key=value` pair.
  const stripped = trimmed.replace(/\s/g, "");
  if (
    stripped.length > 64 &&
    !trimmed.includes("&") &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(stripped)
  ) return "form";
  // Form body: at least one URL-safe key followed by `=`. Catches both
  // multi-pair Twilio bodies (`Key1=a&Key2=b`) and Braintree's two-key
  // wrapper (`bt_signature=…&bt_payload=…`).
  if (/^[A-Za-z0-9_.\-+%]+=/.test(trimmed)) return "form";
  // CSV: first two non-empty lines share a comma/tab/semicolon count.
  // Quoted fields are respected so a `"Smith, John"` cell doesn't inflate
  // the count. Detection is intentionally loose - false positives surface
  // as parse errors rather than data corruption.
  const firstTwo = trimmed.split(/\r?\n/).filter((l) => l.length > 0).slice(0, 2);
  if (firstTwo.length >= 2) {
    for (const delim of [",", "\t", ";"] as const) {
      const a = countUnescaped(firstTwo[0], delim);
      const b = countUnescaped(firstTwo[1], delim);
      if (a >= 1 && a === b) return "csv";
    }
  }
  return null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: () => false,
});

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  format: true,
  indentBy: "    ",
  suppressEmptyNode: false,
  suppressBooleanAttributes: false,
});

export function parseXml(input: string): ParsedInput {
  const parsed = parser.parse(input) as Record<string, JsonValue>;
  const keys = Object.keys(parsed).filter((k) => !k.startsWith("?"));
  if (keys.length !== 1) {
    throw new Error(
      `XML must have a single root element; found ${keys.length} (${keys.join(", ")})`,
    );
  }
  const rootName = keys[0];
  return { data: parsed[rootName] ?? {}, format: "xml", rootName };
}

export function parseJson(input: string): ParsedInput {
  return { data: JSON.parse(input) as JsonValue, format: "json" };
}

export function parseForm(input: string): ParsedInput {
  const trimmed = input.trim();

  // Bare base64 - Braintree bt_payload pasted on its own (no outer form
  // wrapper). detectFormat() gated on length, alphabet, and absence of `&`,
  // so we trust those preconditions here.
  const stripped = trimmed.replace(/\s/g, "");
  if (
    stripped.length > 64 &&
    !trimmed.includes("&") &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(stripped)
  ) {
    const xml = decodeBase64Utf8(stripped);
    const xmlParsed = parseXml(xml);
    return {
      data: xmlParsed.data,
      format: "form",
      rootName: xmlParsed.rootName,
      braintreeWrapper: "base64",
    };
  }

  const params = new URLSearchParams(trimmed);
  if (params.has("bt_payload")) {
    // Braintree: form-wrapped, base64 XML inside.
    const payload = params.get("bt_payload") ?? "";
    const xml = decodeBase64Utf8(payload);
    const xmlParsed = parseXml(xml);
    return {
      data: xmlParsed.data,
      format: "form",
      rootName: xmlParsed.rootName,
      braintreeWrapper: "form",
    };
  }
  // Twilio: flat key/value, preserve original key order for round-trip diff.
  const data: Record<string, JsonValue> = {};
  const formOrder: string[] = [];
  for (const [k, v] of params) {
    data[k] = v;
    formOrder.push(k);
  }
  return { data, format: "form", formOrder, braintreeWrapper: null };
}

export function parseNdjson(input: string): ParsedInput {
  const lines = input.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const data = lines.map((l) => JSON.parse(l) as JsonValue);
  return { data, format: "ndjson" };
}

export function parseCsv(
  input: string,
  delimiterOverride?: CsvDelimiter,
): ParsedInput {
  // Strip BOM that Excel/Sheets exports occasionally emit.
  let src = input;
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  const lineEnding: "\n" | "\r\n" = src.includes("\r\n") ? "\r\n" : "\n";
  let delimiter: CsvDelimiter;
  if (delimiterOverride) {
    delimiter = delimiterOverride;
  } else {
    // Auto-detect from header line by majority count.
    const firstNewline = src.indexOf("\n");
    const headerLine = firstNewline === -1 ? src : src.slice(0, firstNewline);
    delimiter = ",";
    const c = countUnescaped(headerLine, ",");
    const t = countUnescaped(headerLine, "\t");
    const s = countUnescaped(headerLine, ";");
    if (t > c && t >= s) delimiter = "\t";
    else if (s > c && s >= t) delimiter = ";";
  }
  const rows = csvRowSplit(src, delimiter);
  if (rows.length === 0) throw new Error("CSV is empty");
  const headers = rows[0];
  const data = rows.slice(1).map((row) => {
    const obj: Record<string, JsonValue> = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]] = row[i] ?? "";
    }
    return obj;
  });
  return {
    data,
    format: "csv",
    csvHeaders: headers,
    csvDelimiter: delimiter,
    csvLineEnding: lineEnding,
  };
}

export interface ParseOptions {
  /** Force a specific CSV delimiter, overriding auto-detection. */
  csvDelimiter?: CsvDelimiter;
}

export function parseInput(input: string, options?: ParseOptions): ParsedInput {
  const fmt = detectFormat(input);
  if (fmt === "xml") return parseXml(input);
  if (fmt === "json") return parseJson(input);
  if (fmt === "form") return parseForm(input);
  if (fmt === "ndjson") return parseNdjson(input);
  if (fmt === "csv") return parseCsv(input, options?.csvDelimiter);
  throw new Error("Input is not recognized JSON, XML, NDJSON, CSV, or form-encoded data");
}

export function serialize(value: JsonValue, parsed: ParsedInput): string {
  if (parsed.format === "xml" && parsed.rootName) {
    const wrapped = { [parsed.rootName]: value } as Record<string, JsonValue>;
    const xml = builder.build(wrapped);
    return `<?xml version="1.0"?>\n${typeof xml === "string" ? xml.trim() : String(xml)}`;
  }
  if (parsed.format === "form") return serializeForm(value, parsed);
  if (parsed.format === "ndjson") return serializeNdjson(value);
  if (parsed.format === "csv") return serializeCsv(value, parsed);
  return JSON.stringify(value, null, 2);
}

function serializeNdjson(value: JsonValue): string {
  if (!Array.isArray(value)) return JSON.stringify(value);
  return value.map((v) => JSON.stringify(v)).join("\n");
}

function serializeCsv(value: JsonValue, parsed: ParsedInput): string {
  const rows = Array.isArray(value) ? (value as Array<Record<string, JsonValue>>) : [];
  const headers = parsed.csvHeaders ?? (rows[0] ? Object.keys(rows[0]) : []);
  const delim = parsed.csvDelimiter ?? ",";
  const eol = parsed.csvLineEnding ?? "\n";
  const lines = [headers.map(escapeCsvField).join(delim)];
  for (const row of rows) {
    const cells = headers.map((h) => {
      const v = row?.[h];
      return escapeCsvField(v == null ? "" : String(v));
    });
    lines.push(cells.join(delim));
  }
  return lines.join(eol);
}

function escapeCsvField(s: string): string {
  if (/["\r\n\t,;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Count delimiter occurrences in a CSV cell-line, respecting RFC 4180
// quoting. Used by detectFormat to tell CSV apart from non-CSV plaintext.
function countUnescaped(line: string, delim: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') i++;
        else inQuotes = false;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      count++;
    }
  }
  return count;
}

// RFC 4180 CSV tokenizer: state machine that handles quoted fields,
// escaped quotes (`""`), embedded newlines inside quotes, and both LF / CRLF
// line endings.
function csvRowSplit(src: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\r") {
      // Skip; the following \n flushes the row.
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop trailing empty row that a final newline produces.
  while (
    rows.length > 0 &&
    rows[rows.length - 1].length === 1 &&
    rows[rows.length - 1][0] === ""
  ) {
    rows.pop();
  }
  return rows;
}

function serializeForm(value: JsonValue, parsed: ParsedInput): string {
  if (parsed.braintreeWrapper) {
    // Rebuild the XML notification body from the obfuscated tree.
    const rootName = parsed.rootName ?? "notification";
    const wrapped = { [rootName]: value } as Record<string, JsonValue>;
    const xml = builder.build(wrapped);
    const xmlStr = `<?xml version="1.0"?>\n${typeof xml === "string" ? xml.trim() : String(xml)}`;
    if (parsed.braintreeWrapper === "xml") return xmlStr;
    const b64 = encodeBase64Utf8(xmlStr);
    if (parsed.braintreeWrapper === "base64") return b64;
    // "form" wrapper: rebuild bt_signature=&bt_payload=. The signature was
    // computed over the original body - obfuscation invalidates it, so we
    // emit a placeholder rather than the real value.
    const params = new URLSearchParams();
    params.set("bt_signature", "obfuscated-signature-invalid");
    params.set("bt_payload", b64);
    return params.toString();
  }
  // Twilio: flat object back to ordered urlencoded.
  const obj = (value && typeof value === "object" && !Array.isArray(value))
    ? (value as Record<string, JsonValue>)
    : {};
  const params = new URLSearchParams();
  const order = parsed.formOrder ?? Object.keys(obj);
  for (const k of order) {
    if (k in obj) params.append(k, String(obj[k] ?? ""));
  }
  return params.toString();
}

// UTF-8-safe base64 decode. `atob` alone returns a binary string, which
// mojibakes non-ASCII content (common in Braintree merchant names / addresses).
function decodeBase64Utf8(b64: string): string {
  const stripped = b64.replace(/[\s\r\n]+/g, "");
  const bytes = Uint8Array.from(atob(stripped), (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

function encodeBase64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
