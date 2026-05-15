import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { xml } from "@codemirror/lang-xml";
import { RefreshCw, PanelRightOpen, Link2, Link2Off } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import type { InputFormat } from "../engine/xml";
import type { JsonValue } from "../engine/types";
import { modifiedLinesField, setModifiedLines } from "./cmModifiedLines";
import { SplitCopyButton } from "./SplitCopyButton";

interface Props {
  value: string;
  format: InputFormat;
  onRegenerate: () => void;
  error: string | null;
  style?: React.CSSProperties;
  onShowFields?: () => void;
  onReady?: (view: EditorView) => void;
  onUpdate?: (update: ViewUpdate) => void;
  linked: boolean;
  onToggleLink: () => void;
  modifiedLines: Set<number>;
  // Parsed obfuscated payload - used by codegen ("Copy as TS / Zod / JSON
  // Schema"). XML payloads pass null here; the menu disables itself.
  codegenSample: JsonValue | null;
}

export function OutputViewer({
  value,
  format,
  onRegenerate,
  error,
  style,
  onShowFields,
  onReady,
  onUpdate,
  linked,
  onToggleLink,
  modifiedLines,
  codegenSample,
}: Props) {
  const viewRef = useRef<EditorView | null>(null);

  const handleCreate = useCallback(
    (view: EditorView) => {
      viewRef.current = view;
      onReady?.(view);
    },
    [onReady],
  );

  // Push the modified-line set into the editor whenever it changes (or the
  // document changes, which resets the decoration state).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: setModifiedLines.of(modifiedLines) });
  }, [modifiedLines, value]);

  // Memoize: @uiw/react-codemirror reconfigures the editor whenever the
  // extensions prop reference changes. Without this, every parent re-render
  // (e.g. every keystroke in the input pane) would rebuild the editor.
  const extensions = useMemo(() => {
    // CodeMirror's contenteditable surface is a role="textbox" with no
    // accessible name by default - give screen readers something to announce.
    const a11yLabel = EditorView.contentAttributes.of({
      "aria-label": "Obfuscated output",
    });
    if (format === "xml") return [xml(), modifiedLinesField, a11yLabel];
    if (format === "form" || format === "csv")
      return [modifiedLinesField, a11yLabel];
    return [json(), modifiedLinesField, a11yLabel];
  }, [format]);

  return (
    <div className="pane output-pane" style={style}>
      <div className="pane-header">
        <label className="pane-label">Obfuscated output</label>
        <span className="format-pill">{format.toUpperCase()}</span>
        <div className="pane-actions">
          <button
            onClick={onToggleLink}
            title={linked ? "Unlink panes (scroll/cursor independent)" : "Link panes (sync scroll + active line)"}
            className={`link-toggle${linked ? " linked" : ""}`}
          >
            {linked ? <Link2 size={14} /> : <Link2Off size={14} />}
            <span className="btn-label">{linked ? "Linked" : "Unlinked"}</span>
          </button>
          <button onClick={onRegenerate} title="Re-roll with new seed">
            <RefreshCw size={14} />
            <span className="btn-label">New seed</span>
          </button>
          <SplitCopyButton text={value} codegenSample={codegenSample} />
          {onShowFields && (
            <button onClick={onShowFields} title="Show field controls">
              <PanelRightOpen size={14} />
              <span className="btn-label">Fields</span>
            </button>
          )}
        </div>
      </div>
      {error ? (
        <div className="error-state">{error}</div>
      ) : (
        <CodeMirror
          value={value}
          height="100%"
          theme="dark"
          editable={false}
          extensions={extensions}
          onCreateEditor={handleCreate}
          onUpdate={onUpdate}
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            highlightActiveLine: true,
          }}
        />
      )}
    </div>
  );
}
