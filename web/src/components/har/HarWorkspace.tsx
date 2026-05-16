import { useCallback, useMemo, useRef, useState } from "react";
import {
  Upload,
  Loader,
  Check,
  AlertTriangle,
  Download,
  RotateCcw,
  X,
} from "lucide-react";
import { useHarObfuscator } from "../../hooks/useHarObfuscator";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { checkHarGate } from "../../engine/harConstants";
import {
  DEFAULT_POLICY,
  type RedactionPolicy,
  type HarOverrides,
  type HarOverrideRule,
} from "../../engine/har";
import { downloadBlob } from "../../utils/zip";
import { HAR_EXT, SECTION_CATEGORY, runSignature, intendedRedact } from "./shared";
import { PolicyPanel } from "./PolicyPanel";
import { ValueTree } from "./ValueTree";

/** HAR mode: drop a capture, review every flagged value as a tree, download
 *  the obfuscated result. The heavy work runs in a worker (see the hook). */
export function HarWorkspace() {
  const { state, process, reprocess, reset } = useHarObfuscator();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [dragging, setDragging] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [policy, setPolicy] = useState<RedactionPolicy>(DEFAULT_POLICY);
  const [overrides, setOverrides] = useState<HarOverrides>({});
  const [appliedSig, setAppliedSig] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      setGateError(null);
      setWarning(null);
      if (!HAR_EXT.test(file.name)) {
        setGateError("That doesn't look like a HAR file. Choose a .har file.");
        return;
      }
      const gate = checkHarGate(file.size, isMobile);
      if (gate.kind === "refuse") {
        setGateError(gate.message);
        return;
      }
      if (gate.kind === "warn") setWarning(gate.message);
      setAppliedSig(runSignature(policy, overrides));
      process(file, policy, overrides);
    },
    [isMobile, policy, overrides, process],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const onPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      e.target.value = "";
    },
    [handleFile],
  );

  const handleDownload = useCallback(() => {
    if (state.resultBlob && state.resultName) {
      downloadBlob(state.resultBlob, state.resultName);
    }
  }, [state.resultBlob, state.resultName]);

  const handleReset = useCallback(() => {
    setGateError(null);
    setWarning(null);
    reset();
  }, [reset]);

  const handleRerun = useCallback(() => {
    setAppliedSig(runSignature(policy, overrides));
    reprocess(policy, overrides);
  }, [policy, overrides, reprocess]);

  const togglePolicy = useCallback((key: keyof RedactionPolicy) => {
    setPolicy((p) => ({ ...p, [key]: !p[key] }));
  }, []);

  const setOverride = useCallback((id: string, rule: HarOverrideRule | null) => {
    setOverrides((prev) => {
      const next = { ...prev };
      if (rule === null) delete next[id];
      else next[id] = rule;
      return next;
    });
  }, []);

  const flaggedCount = useMemo(
    () => state.targets.filter((t) => intendedRedact(t, overrides)).length,
    [state.targets, overrides],
  );

  const categoryCounts = useMemo(() => {
    const c: Record<keyof RedactionPolicy, number> = {
      headers: 0,
      params: 0,
      bodies: 0,
      ips: 0,
    };
    for (const t of state.targets) {
      if (intendedRedact(t, overrides)) c[SECTION_CATEGORY[t.section]]++;
    }
    return c;
  }, [state.targets, overrides]);

  const liveSig = useMemo(() => runSignature(policy, overrides), [policy, overrides]);

  const showDropzone = state.phase === "idle" || state.phase === "error";
  const processing = state.phase === "processing";
  const progressPct =
    state.progress && state.progress.total > 0
      ? Math.round((state.progress.done / state.progress.total) * 100)
      : 0;
  const settingsDrifted =
    state.phase === "done" && appliedSig !== null && liveSig !== appliedSig;
  const noneSelected = Object.values(policy).every((v) => !v);

  return (
    <div className="workspace har-workspace">
      <div className="har-intro">
        <h2 className="har-intro-title">HAR file obfuscator</h2>
        <p className="har-intro-text">
          Drop a HAR capture — the network log your browser's DevTools exports.
          doppelforge scans every request and response, flags what's sensitive
          (credential headers, session cookies, secret params, server IPs, PII
          in JSON/XML bodies), and shows it as one tree of{" "}
          <em>current value → realistic replacement</em>. Tick what to redact,
          set custom values, drill into where each value is used, then re-run.
          Everything happens in your browser — nothing is uploaded.
        </p>
      </div>

      <PolicyPanel
        policy={policy}
        disabled={processing}
        counts={categoryCounts}
        showCounts={state.phase === "done"}
        onToggle={togglePolicy}
      />

      {showDropzone && (
        <div
          className={`batch-dropzone har-dropzone${dragging ? " dragging" : ""}${noneSelected ? " disabled" : ""}`}
          onDrop={onDrop}
          onDragOver={(e) => {
            e.preventDefault();
            if (!noneSelected) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onClick={() => {
            if (!noneSelected) inputRef.current?.click();
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && !noneSelected) {
              inputRef.current?.click();
            }
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".har,application/json"
            onChange={onPick}
            style={{ display: "none" }}
          />
          <Upload size={20} />
          <span className="batch-dropzone-label">
            {noneSelected
              ? "Turn on at least one redaction category above"
              : "Drop a .har file here, or click to browse"}
          </span>
          <span className="batch-dropzone-hint">
            Processed entirely in your browser — nothing is uploaded.
          </span>
        </div>
      )}

      {gateError && (
        <div className="har-banner har-banner-error" role="alert">
          <AlertTriangle size={14} />
          <span>{gateError}</span>
        </div>
      )}

      {state.phase === "error" && state.error && (
        <div className="har-banner har-banner-error" role="alert">
          <AlertTriangle size={14} />
          <span>Could not process this HAR: {state.error}</span>
        </div>
      )}

      {warning && state.phase !== "idle" && (
        <div className="har-banner har-banner-warn" role="status">
          <AlertTriangle size={14} />
          <span>{warning}</span>
        </div>
      )}

      {processing && (
        <div className="har-progress">
          <div className="har-progress-head">
            <Loader size={14} className="har-spin" />
            <span>
              {state.progress && state.progress.total > 0
                ? `Obfuscating entries — ${state.progress.done} / ${state.progress.total}`
                : "Parsing HAR…"}
            </span>
            <button className="batch-reseed har-progress-cancel" onClick={handleReset}>
              <X size={12} />
              Cancel
            </button>
          </div>
          <div className="har-progress-track">
            <div className="har-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      )}

      {state.phase === "done" && state.stats && (
        <div className="har-result">
          <div className="har-result-head">
            <Check size={16} className="har-result-check" />
            <span>
              {state.stats.entries.toLocaleString()} entries scanned ·{" "}
              <strong>{flaggedCount.toLocaleString()}</strong> value
              {flaggedCount === 1 ? "" : "s"} flagged for obfuscation
            </span>
          </div>

          {settingsDrifted && (
            <div className="har-banner har-banner-warn" role="status">
              <AlertTriangle size={14} />
              <div className="har-rerun-row">
                <span>Selections changed. Re-run to apply them to the HAR.</span>
                <button className="batch-run har-rerun-btn" onClick={handleRerun}>
                  <RotateCcw size={12} />
                  Re-run
                </button>
              </div>
            </div>
          )}

          <ValueTree
            targets={state.targets}
            overrides={overrides}
            policy={policy}
            onSet={setOverride}
          />

          {state.stats.entryErrors.length > 0 && (
            <div className="har-banner har-banner-warn" role="status">
              <AlertTriangle size={14} />
              <div>
                <strong>
                  {state.stats.entryErrors.length} entr
                  {state.stats.entryErrors.length === 1 ? "y" : "ies"} left
                  partly unobfuscated:
                </strong>
                <ul className="har-error-list">
                  {state.stats.entryErrors.slice(0, 5).map((e, i) => (
                    <li key={i}>
                      Entry #{e.entry}: {e.message}
                    </li>
                  ))}
                  {state.stats.entryErrors.length > 5 && (
                    <li>…and {state.stats.entryErrors.length - 5} more.</li>
                  )}
                </ul>
              </div>
            </div>
          )}

          <div className="har-result-actions">
            <button className="batch-run" onClick={handleDownload}>
              <Download size={12} />
              Download {state.resultName}
            </button>
            <button className="batch-reseed" onClick={handleReset}>
              <RotateCcw size={12} />
              Process another
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
