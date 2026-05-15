import CodeMirror from "@uiw/react-codemirror";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { xml } from "@codemirror/lang-xml";
import { linter } from "@codemirror/lint";
import { RotateCcw } from "lucide-react";
import { useMemo } from "react";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import type { CsvDelimiter, InputFormat } from "../engine/xml";
import { useInputHistory } from "../hooks/useInputHistory";
import { InputHistoryDropdown } from "./InputHistoryDropdown";

interface Props {
  value: string;
  onChange: (value: string) => void;
  urlHint: string;
  onUrlHintChange: (value: string) => void;
  onReset: () => void;
  onReady?: (view: EditorView) => void;
  onUpdate?: (update: ViewUpdate) => void;
  format: InputFormat;
  /** Delimiter chosen by auto-detection (read from the parsed CSV). */
  csvDetectedDelimiter?: CsvDelimiter | null;
  /** Active manual override; null means use auto-detection. */
  csvDelimiterOverride?: CsvDelimiter | null;
  onCsvDelimiterChange?: (next: CsvDelimiter | null) => void;
  style?: React.CSSProperties;
}

// Mnemonic codes for the select options - encoding raw "\t" as a value
// attribute renders poorly and trims unpredictably in some browsers.
const DELIM_DECODE: Record<string, CsvDelimiter | null> = {
  "": null,
  comma: ",",
  tab: "\t",
  semicolon: ";",
};
const DELIM_ENCODE = (d: CsvDelimiter | null): string =>
  d === "," ? "comma" : d === "\t" ? "tab" : d === ";" ? "semicolon" : "";
const DELIM_LABEL = (d: CsvDelimiter | null): string =>
  d === "," ? "," : d === "\t" ? "tab" : d === ";" ? ";" : "?";

export function InputEditor({
  value,
  onChange,
  urlHint,
  onUrlHintChange,
  onReset,
  onReady,
  onUpdate,
  format,
  csvDetectedDelimiter,
  csvDelimiterOverride,
  onCsvDelimiterChange,
  style,
}: Props) {
  // Memoize: @uiw/react-codemirror calls StateEffect.reconfigure on every
  // change to this prop's reference. A fresh array per render would re-init
  // the editor on every keystroke.
  const extensions = useMemo(() => {
    if (format === "xml") return [xml()];
    if (format === "form" || format === "csv") return [];
    if (format === "ndjson") return [json()];
    return [json(), linter(jsonParseLinter())];
  }, [format]);

  const {
    entries,
    clearHistory,
    removeEntry,
    retention,
    setRetention,
    currentTooLarge,
  } = useInputHistory(value, urlHint);

  return (
    <div className="pane input-pane" style={style}>
      <div className="pane-header">
        <label className="pane-label">Real response</label>
        <span className="format-pill">{format.toUpperCase()}</span>
        {format === "csv" && onCsvDelimiterChange && (
          <select
            className="csv-delim-select"
            value={DELIM_ENCODE(csvDelimiterOverride ?? null)}
            onChange={(e) => onCsvDelimiterChange(DELIM_DECODE[e.target.value] ?? null)}
            title="CSV delimiter - auto-detected from the header row by default"
          >
            <option value="">
              auto ({DELIM_LABEL(csvDetectedDelimiter ?? null)})
            </option>
            <option value="comma">,</option>
            <option value="tab">tab</option>
            <option value="semicolon">;</option>
          </select>
        )}
        <input
          className="url-hint"
          type="text"
          placeholder="Optional: paste request URL (helps auto-detect)"
          value={urlHint}
          onChange={(e) => onUrlHintChange(e.target.value)}
        />
        <div className="pane-actions">
          <InputHistoryDropdown
            entries={entries}
            onRestore={(entry) => {
              onChange(entry.text);
              onUrlHintChange(entry.urlHint);
            }}
            onClear={clearHistory}
            onRemove={removeEntry}
            retention={retention}
            onRetentionChange={setRetention}
            currentTooLarge={currentTooLarge}
          />
          <button onClick={onReset} disabled={!value && !urlHint} title="Clear the input">
            <RotateCcw size={14} />
            <span className="btn-label">Reset</span>
          </button>
        </div>
      </div>
      <CodeMirror
        value={value}
        height="100%"
        theme="dark"
        extensions={extensions}
        onChange={onChange}
        onCreateEditor={onReady}
        onUpdate={onUpdate}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: true,
        }}
      />
    </div>
  );
}
