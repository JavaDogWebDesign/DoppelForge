import { useCallback, useRef, useState } from "react";
import { Upload } from "lucide-react";
import type { BatchFile } from "../engine/batch";

interface Props {
  onAdd: (files: BatchFile[]) => void;
  disabled?: boolean;
}

const ACCEPTED_EXT = /\.(json|xml)$/i;
// Refuse files this big to avoid OOMing the tab on accidental drops.
// 25 MB is far above any realistic API response; raise if real workloads
// need more.
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const SKIP_MESSAGE_MS = 5000;

async function readAsBatchFile(file: File, idx: number): Promise<BatchFile> {
  const text = await file.text();
  return {
    id: `${Date.now()}-${idx}-${file.name}`,
    name: file.name,
    text,
    size: file.size,
  };
}

export function BatchDropzone({ onAdd, disabled }: Props) {
  const [dragging, setDragging] = useState(false);
  const [skipped, setSkipped] = useState<string[]>([]);
  const skipTimerRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const flashSkipped = useCallback((names: string[]) => {
    if (names.length === 0) return;
    setSkipped(names);
    if (skipTimerRef.current !== null) window.clearTimeout(skipTimerRef.current);
    skipTimerRef.current = window.setTimeout(() => {
      setSkipped([]);
      skipTimerRef.current = null;
    }, SKIP_MESSAGE_MS);
  }, []);

  const ingest = useCallback(
    async (fileList: FileList | File[]) => {
      const all = Array.from(fileList).filter((f) => ACCEPTED_EXT.test(f.name));
      const oversize = all.filter((f) => f.size > MAX_FILE_BYTES);
      const files = all.filter((f) => f.size <= MAX_FILE_BYTES);
      if (oversize.length > 0) flashSkipped(oversize.map((f) => f.name));
      if (files.length === 0) return;
      const batch = await Promise.all(files.map((f, i) => readAsBatchFile(f, i)));
      onAdd(batch);
    },
    [onAdd, flashSkipped],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
      if (disabled) return;
      if (e.dataTransfer.files.length > 0) {
        void ingest(e.dataTransfer.files);
      }
    },
    [ingest, disabled],
  );

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!disabled) setDragging(true);
  }, [disabled]);

  const onDragLeave = useCallback(() => {
    setDragging(false);
  }, []);

  const onPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) void ingest(e.target.files);
      e.target.value = "";
    },
    [ingest],
  );

  return (
    <div
      className={`batch-dropzone${dragging ? " dragging" : ""}${disabled ? " disabled" : ""}`}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".json,.xml,application/json,application/xml,text/xml"
        multiple
        onChange={onPick}
        style={{ display: "none" }}
      />
      <Upload size={20} />
      <span className="batch-dropzone-label">
        Drop JSON or XML files here, or click to browse
      </span>
      <span className="batch-dropzone-hint">
        All files processed in your browser - nothing is uploaded.
      </span>
      {skipped.length > 0 && (
        <span className="batch-dropzone-skipped" role="alert">
          Skipped (over 25 MB): {skipped.join(", ")}
        </span>
      )}
    </div>
  );
}
