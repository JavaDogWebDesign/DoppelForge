import CodeMirror from "@uiw/react-codemirror";
import { yaml } from "@codemirror/lang-yaml";
import { useMemo } from "react";

interface Props {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  minHeight?: string;
  ariaLabel?: string;
}

/**
 * Small dark-theme YAML editor used inside the custom-provider modal.
 * Memoizes the extensions array so @uiw/react-codemirror doesn't reconfigure
 * the editor on every parent re-render (same fix pattern as InputEditor).
 */
export function YamlEditor({
  value,
  onChange,
  placeholder,
  minHeight = "120px",
  ariaLabel,
}: Props) {
  const extensions = useMemo(() => [yaml()], []);
  return (
    <div className="yaml-editor" aria-label={ariaLabel}>
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme="dark"
        placeholder={placeholder}
        minHeight={minHeight}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: true,
          highlightSelectionMatches: false,
          tabSize: 2,
        }}
      />
    </div>
  );
}
