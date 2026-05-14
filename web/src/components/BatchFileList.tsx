import { CheckCircle2, AlertCircle, Circle, X, Star } from "lucide-react";
import type { BatchFile, BatchResult } from "../engine/batch";

interface Props {
  files: BatchFile[];
  results: Map<string, BatchResult>;
  schemaSourceId: string | null;
  onRemove: (id: string) => void;
  onPickSchemaSource: (id: string) => void;
  onClear: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function StatusIcon({ result }: { result: BatchResult | undefined }) {
  if (!result) return <Circle size={14} className="batch-status-pending" />;
  if (result.status.kind === "done")
    return <CheckCircle2 size={14} className="batch-status-done" />;
  if (result.status.kind === "error")
    return <AlertCircle size={14} className="batch-status-error" />;
  return <Circle size={14} className="batch-status-pending" />;
}

export function BatchFileList({
  files,
  results,
  schemaSourceId,
  onRemove,
  onPickSchemaSource,
  onClear,
}: Props) {
  if (files.length === 0) return null;

  return (
    <div className="batch-file-list">
      <div className="batch-file-list-header">
        <span className="pane-label">
          {files.length} file{files.length === 1 ? "" : "s"}
        </span>
        <button onClick={onClear} title="Remove all files" className="batch-clear">
          Clear
        </button>
      </div>
      <ul className="batch-files">
        {files.map((f) => {
          const r = results.get(f.id);
          const isSchemaSource = schemaSourceId === f.id;
          return (
            <li key={f.id} className={isSchemaSource ? "is-schema-source" : ""}>
              <StatusIcon result={r} />
              <div className="batch-file-meta">
                <span className="batch-file-name" title={f.name}>
                  {f.name}
                </span>
                <span className="batch-file-size">{formatSize(f.size)}</span>
                {r?.status.kind === "error" && (
                  <span className="batch-file-error" title={r.status.message}>
                    {r.status.message}
                  </span>
                )}
              </div>
              <button
                className="batch-schema-pick"
                onClick={() => onPickSchemaSource(f.id)}
                title={
                  isSchemaSource
                    ? "Field controls are detected from this file"
                    : "Use this file's fields for the controls panel"
                }
                aria-label="Use as schema source"
              >
                <Star
                  size={12}
                  fill={isSchemaSource ? "currentColor" : "none"}
                />
              </button>
              <button
                className="batch-file-remove"
                onClick={() => onRemove(f.id)}
                title="Remove file"
                aria-label="Remove file"
              >
                <X size={12} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
