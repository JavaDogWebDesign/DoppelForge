import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, RotateCcw, Link2, Link2Off } from "lucide-react";
import { BatchDropzone } from "./BatchDropzone";
import { BatchFileList } from "./BatchFileList";
import { FieldControlsPanel } from "./FieldControlsPanel";
import { EndpointBadge } from "./EndpointBadge";
import { Splitter } from "./Splitter";
import { useBatchObfuscator } from "../hooks/useBatchObfuscator";
import { useLocalStorageState, numberCodec } from "../hooks/useLocalStorageState";
import type { BatchFile } from "../engine/batch";
import { obfuscatedFilename } from "../engine/batch";
import type { EndpointSpec, Provider } from "../engine/types";
import { bestMatch } from "../engine/Matcher";
import { parseInput } from "../engine/xml";
import { buildZip, downloadBlob } from "../utils/zip";

const SPLIT_RATIO_KEY = "doppelforge.batch.splitRatio";
const clampSplitRatio = (n: number) => Math.max(0.15, Math.min(0.85, n));

interface Props {
  provider: Provider | null;
  allProviders: Provider[];
  onSelectProvider: (id: string) => void;
}

type DetectionSource = "explicit" | "signature" | "none";

export function BatchWorkspace({
  provider,
  allProviders,
  onSelectProvider,
}: Props) {
  const [files, setFiles] = useState<BatchFile[]>([]);
  const [schemaSourceId, setSchemaSourceId] = useState<string | null>(null);
  const [explicitEndpointId, setExplicitEndpointId] = useState<string | null>(
    null,
  );
  const [splitRatio, setSplitRatio] = useLocalStorageState(
    SPLIT_RATIO_KEY,
    0.5,
    numberCodec(clampSplitRatio),
  );
  const panesRef = useRef<HTMLDivElement | null>(null);

  const handleSplitterDrag = useCallback(
    ({ clientX, rect }: { clientX: number; rect: DOMRect }) => {
      const ratio = (clientX - rect.left) / rect.width;
      setSplitRatio(clampSplitRatio(ratio));
    },
    [setSplitRatio],
  );

  const batch = useBatchObfuscator();

  const schemaSource = useMemo(
    () =>
      files.find((f) => f.id === schemaSourceId) ?? files[0] ?? null,
    [files, schemaSourceId],
  );

  // Endpoint detection from the schema source file. Manual dropdown selection
  // wins; otherwise we run cross-provider signature matching like single mode.
  const { endpoint, detectedFrom, detectedProviderId } = useMemo<{
    endpoint: EndpointSpec | null;
    detectedFrom: DetectionSource;
    detectedProviderId: string | null;
  }>(() => {
    if (explicitEndpointId && provider) {
      const ep =
        provider.endpoints.find((e) => e.id === explicitEndpointId) ?? null;
      if (ep) {
        return {
          endpoint: ep,
          detectedFrom: "explicit",
          detectedProviderId: provider.manifest.id,
        };
      }
    }
    if (!schemaSource) {
      return { endpoint: null, detectedFrom: "none", detectedProviderId: null };
    }
    try {
      const parsed = parseInput(schemaSource.text);
      const allEndpoints = allProviders.flatMap((p) => p.endpoints);
      const match = bestMatch(parsed.data, allEndpoints);
      if (match) {
        return {
          endpoint: match.endpoint,
          detectedFrom: "signature",
          detectedProviderId: match.endpoint.providerId,
        };
      }
    } catch {
      /* ignore — file may be invalid; we still surface it in the list */
    }
    return { endpoint: null, detectedFrom: "none", detectedProviderId: null };
  }, [schemaSource, allProviders, explicitEndpointId, provider]);

  useEffect(() => {
    if (explicitEndpointId) return;
    if (!detectedProviderId) return;
    if (detectedProviderId === provider?.manifest.id) return;
    onSelectProvider(detectedProviderId);
  }, [
    detectedProviderId,
    explicitEndpointId,
    provider?.manifest.id,
    onSelectProvider,
  ]);

  useEffect(() => {
    setExplicitEndpointId(null);
  }, [provider?.manifest.id]);

  const detected = useMemo(
    () => (schemaSource ? batch.detect(schemaSource.text, endpoint) : null),
    [schemaSource, endpoint, batch],
  );

  const addFiles = useCallback((incoming: BatchFile[]) => {
    setFiles((prev) => {
      // Dedupe by name+size; keep first occurrence.
      const seen = new Set(prev.map((f) => `${f.name}::${f.size}`));
      const merged = [...prev];
      for (const f of incoming) {
        const key = `${f.name}::${f.size}`;
        if (!seen.has(key)) {
          merged.push(f);
          seen.add(key);
        }
      }
      return merged;
    });
    batch.clearResults();
  }, [batch]);

  const removeFile = useCallback(
    (id: string) => {
      setFiles((prev) => prev.filter((f) => f.id !== id));
      if (schemaSourceId === id) setSchemaSourceId(null);
      batch.clearResults();
    },
    [schemaSourceId, batch],
  );

  const clearAll = useCallback(() => {
    setFiles([]);
    setSchemaSourceId(null);
    batch.clearResults();
  }, [batch]);

  const handleObfuscateAndDownload = useCallback(() => {
    if (files.length === 0) return;
    const results = batch.run(files, endpoint);
    const entries: Array<{ name: string; content: string }> = [];
    for (const r of results) {
      if (r.status.kind !== "done") continue;
      const file = files.find((f) => f.id === r.fileId);
      if (!file) continue;
      entries.push({
        name: obfuscatedFilename(file.name),
        content: r.status.outputText,
      });
    }
    if (entries.length === 0) return;
    const blob = buildZip(entries);
    const today = new Date().toISOString().slice(0, 10);
    downloadBlob(blob, `obfuscated-${today}.zip`);
  }, [files, endpoint, batch]);

  const endpointsForProvider = provider?.endpoints ?? [];

  return (
    <div className="workspace batch-workspace">
      <EndpointBadge
        endpoint={endpoint}
        endpoints={endpointsForProvider}
        detectedFrom={detectedFrom}
        onChange={setExplicitEndpointId}
      />
      <div className="batch-toolbar">
        <div className="batch-toolbar-spacer" />
        <button
          className="batch-reseed"
          onClick={batch.reseed}
          title="Pick a fresh seed so the next run produces different fakes"
        >
          <RotateCcw size={12} />
          Reseed
        </button>
        <button
          className="batch-run"
          onClick={handleObfuscateAndDownload}
          disabled={files.length === 0}
        >
          <Download size={12} />
          Obfuscate {files.length || ""} file{files.length === 1 ? "" : "s"} &amp; download zip
        </button>
      </div>
      <div className="panes batch-panes" ref={panesRef}>
        <div
          className="pane batch-input-pane"
          style={{ flexGrow: splitRatio }}
        >
          <BatchDropzone onAdd={addFiles} />
          <BatchFileList
            files={files}
            results={batch.results}
            schemaSourceId={schemaSource?.id ?? null}
            onRemove={removeFile}
            onPickSchemaSource={setSchemaSourceId}
            onClear={clearAll}
          />
        </div>
        <Splitter
          containerRef={panesRef}
          onDrag={handleSplitterDrag}
          onReset={() => setSplitRatio(0.5)}
        />
        <div
          className="batch-right-pane"
          style={{ flexGrow: 1 - splitRatio }}
        >
          <div
            className="batch-policy-row"
            title={
              batch.consistent
                ? "Same real value → same fake across all files. Click to make each file independent."
                : "Each file gets a fresh seed → fakes vary file-to-file. Click to share fakes across files."
            }
          >
            <span className="batch-policy-label">Across files:</span>
            <button
              className={`batch-consistency-pill${batch.consistent ? " on" : " off"}`}
              onClick={() => batch.setConsistent(true)}
              aria-pressed={batch.consistent}
            >
              <Link2 size={12} />
              Consistent
            </button>
            <button
              className={`batch-consistency-pill${!batch.consistent ? " on" : " off"}`}
              onClick={() => batch.setConsistent(false)}
              aria-pressed={!batch.consistent}
            >
              <Link2Off size={12} />
              Independent
            </button>
            <span className="batch-policy-hint">
              {batch.consistent
                ? "same value → same fake"
                : "each file gets unique fakes"}
            </span>
          </div>
          <FieldControlsPanel
            fields={detected?.fields ?? []}
            stats={detected?.stats ?? null}
            overrideCount={batch.overrides.size + batch.valueOverrides.size}
            hasSaved={false}
            valueOverrides={batch.valueOverrides}
            onToggle={batch.setOverride}
            onSetValueOverride={batch.setValueOverride}
            onReset={batch.resetOverrides}
            onHide={() => {
              /* batch mode keeps the panel pinned */
            }}
          />
        </div>
      </div>
    </div>
  );
}
