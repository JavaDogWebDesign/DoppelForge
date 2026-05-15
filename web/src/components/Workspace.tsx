import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { InputEditor } from "./InputEditor";
import { OutputViewer } from "./OutputViewer";
import { EndpointBadge } from "./EndpointBadge";
import { FieldControlsPanel } from "./FieldControlsPanel";
import { Splitter } from "./Splitter";
import { bestMatch, matchByUrl } from "../engine/Matcher";
import type { EndpointSpec, Provider } from "../engine/types";
import type { TransformResult } from "../engine/TransformEngine";
import { useObfuscator } from "../hooks/useObfuscator";
import {
  useLocalStorageState,
  numberCodec,
  intCodec,
  boolCodec,
} from "../hooks/useLocalStorageState";
import {
  useCursorSync,
  useFoldSync,
  useScrollSync,
} from "../hooks/useEditorSync";
import { useGlobalSelectAll } from "../hooks/useGlobalSelectAll";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { SettingsDrawer } from "./SettingsDrawer";
import {
  parseInput,
  serialize,
  type CsvDelimiter,
  type InputFormat,
  type ParsedInput,
} from "../engine/xml";

interface Props {
  provider: Provider | null;
  allProviders: Provider[];
  onSelectProvider: (id: string) => void;
  /** True while the user has manually picked a provider in the sidebar.
   *  Suppresses the auto-switch effect below until reset. */
  manualSelection: boolean;
  /** Workspace calls this on paste to release the manual-selection lock so
   *  fresh input can flow through auto-detect again. */
  onResetManualSelection: () => void;
  /** Reports the detected input format (or null when input is empty/invalid)
   *  so the sidebar's "Supported formats" section can highlight it. */
  onDetectedFormatChange?: (format: InputFormat | null) => void;
}

type DetectionSource = "explicit" | "url" | "signature" | "none";

interface ParseState {
  parsed: ParsedInput | null;
  parseError: string | null;
}

const SPLIT_RATIO_KEY = "doppelforge.splitRatio";
const FIELDS_WIDTH_KEY = "doppelforge.fieldsPaneWidth";
const LINKED_KEY = "doppelforge.linked";
const DEFAULT_FIELDS_WIDTH = 340;
const MIN_FIELDS_WIDTH = 220;
const MAX_FIELDS_WIDTH_RATIO = 0.5;

const clampSplitRatio = (n: number) => Math.max(0.15, Math.min(0.85, n));
const clampFieldsWidth = (n: number) => Math.max(MIN_FIELDS_WIDTH, n);

export function Workspace({
  provider,
  allProviders,
  onSelectProvider,
  manualSelection,
  onResetManualSelection,
  onDetectedFormatChange,
}: Props) {
  const [inputText, setInputText] = useState("");
  const [urlHint, setUrlHint] = useState("");
  const [outputText, setOutputText] = useState("");
  const [outputFormat, setOutputFormat] = useState<InputFormat>("json");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TransformResult | null>(null);
  const [explicitEndpointId, setExplicitEndpointId] = useState<string | null>(null);
  const [splitRatio, setSplitRatio] = useLocalStorageState(
    SPLIT_RATIO_KEY,
    0.5,
    numberCodec(clampSplitRatio),
  );
  const [fieldsPaneWidth, setFieldsPaneWidth] = useLocalStorageState(
    FIELDS_WIDTH_KEY,
    DEFAULT_FIELDS_WIDTH,
    intCodec(clampFieldsWidth),
  );
  // Always start visible on a fresh load; user can still hide within the
  // session via the panel header button, but a refresh resets to visible.
  const [fieldsPaneVisible, setFieldsPaneVisible] = useState<boolean>(true);
  const [linked, setLinked] = useLocalStorageState(LINKED_KEY, true, boolCodec);
  // When the layout switches to the stacked tablet/mobile view, mirroring the
  // scroll position between the two now-vertical panes feels jarring — every
  // scroll snaps both panes. Disable scroll sync at the stacked breakpoint
  // but leave cursor sync running so the active-line highlight still mirrors.
  const isStacked = useMediaQuery("(max-width: 1100px)");
  // Manual CSV delimiter override. null = use auto-detection from the header
  // row. Reset on paste and on Clear so a fresh payload re-runs detection.
  const [csvDelimiterOverride, setCsvDelimiterOverride] =
    useState<CsvDelimiter | null>(null);

  const panesRef = useRef<HTMLDivElement | null>(null);
  const inputViewRef = useRef<EditorView | null>(null);
  const outputViewRef = useRef<EditorView | null>(null);
  const linkedRef = useRef(linked);
  useEffect(() => {
    linkedRef.current = linked;
  }, [linked]);

  const handleInputReady = useCallback((view: EditorView) => {
    inputViewRef.current = view;
    // After a paste, CodeMirror parks the caret at the end of inserted text
    // and auto-scrolls to keep it visible. We pin both panes to the top AND
    // move the caret to position 0 so the visible viewport and the active
    // line agree — otherwise the first arrow-key press teleports the user
    // back to the bottom of a freshly pasted payload.
    view.dom.addEventListener("paste", () => {
      // A new paste means a new payload — drop any manual CSV delimiter
      // override AND release the sidebar manual-selection lock so
      // auto-detection runs against the fresh content.
      setCsvDelimiterOverride(null);
      onResetManualSelection();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const iv = inputViewRef.current;
          const ov = outputViewRef.current;
          if (iv) {
            iv.dispatch({ selection: { anchor: 0 }, scrollIntoView: false });
            iv.scrollDOM.scrollTo({ top: 0 });
          }
          if (ov) {
            ov.dispatch({ selection: { anchor: 0 }, scrollIntoView: false });
            ov.scrollDOM.scrollTo({ top: 0 });
          }
        });
      });
    });
  }, []);
  const handleOutputReady = useCallback((view: EditorView) => {
    outputViewRef.current = view;
  }, []);

  useScrollSync({
    inputViewRef,
    outputViewRef,
    enabled: linked && !isStacked,
    rebindKey: outputText,
  });
  const { handleInputUpdate: cursorInputUpdate } = useCursorSync({
    inputViewRef,
    outputViewRef,
    rebindKey: outputText,
  });
  const { handleInputUpdate: foldInputUpdate, handleOutputUpdate } = useFoldSync({
    inputViewRef,
    outputViewRef,
    linkedRef,
  });
  const handleInputUpdate = useCallback(
    (update: ViewUpdate) => {
      cursorInputUpdate(update);
      foldInputUpdate(update);
    },
    [cursorInputUpdate, foldInputUpdate],
  );
  useGlobalSelectAll({ inputViewRef, outputViewRef });

  const { parsed: parsedInput, parseError } = useMemo<ParseState>(() => {
    if (!inputText.trim()) return { parsed: null, parseError: null };
    try {
      const options = csvDelimiterOverride
        ? { csvDelimiter: csvDelimiterOverride }
        : undefined;
      return { parsed: parseInput(inputText, options), parseError: null };
    } catch (err) {
      return {
        parsed: null,
        parseError: err instanceof Error ? err.message : String(err),
      };
    }
  }, [inputText, csvDelimiterOverride]);

  // Cross-provider detection. Manual endpoint-dropdown selection wins (scoped
  // to the currently selected provider). URL hint + signature search across
  // every provider's endpoints; the auto-switch effect below moves the sidebar
  // to whichever provider produced the match.
  const { endpoint, detectedFrom, detectedProviderId } = useMemo<{
    endpoint: EndpointSpec | null;
    detectedFrom: DetectionSource;
    detectedProviderId: string | null;
  }>(() => {
    if (explicitEndpointId && provider) {
      const ep = provider.endpoints.find((e) => e.id === explicitEndpointId) ?? null;
      if (ep) {
        return {
          endpoint: ep,
          detectedFrom: "explicit",
          detectedProviderId: provider.manifest.id,
        };
      }
    }

    if (urlHint.trim()) {
      for (const p of allProviders) {
        const ep = matchByUrl(urlHint, p.endpoints);
        if (ep) {
          return {
            endpoint: ep,
            detectedFrom: "url",
            detectedProviderId: p.manifest.id,
          };
        }
      }
    }

    if (parsedInput) {
      const allEndpoints = allProviders.flatMap((p) => p.endpoints);
      const match = bestMatch(parsedInput.data, allEndpoints);
      if (match) {
        return {
          endpoint: match.endpoint,
          detectedFrom: "signature",
          detectedProviderId: match.endpoint.providerId,
        };
      }
    }

    return { endpoint: null, detectedFrom: "none", detectedProviderId: null };
  }, [provider, allProviders, explicitEndpointId, urlHint, parsedInput]);

  // When the matcher lands on a different provider than the sidebar shows,
  // promote that provider so the endpoint dropdown + brand context follow.
  // Skip when:
  //  - the user pinned an explicit endpoint (hard override), or
  //  - the user clicked a provider in the sidebar (manualSelection lock).
  // Both kinds of manual selection survive until the next paste, at which
  // point Workspace's paste handler resets the lock.
  useEffect(() => {
    if (explicitEndpointId) return;
    if (manualSelection) return;
    if (!detectedProviderId) return;
    if (detectedProviderId === provider?.manifest.id) return;
    onSelectProvider(detectedProviderId);
  }, [
    detectedProviderId,
    explicitEndpointId,
    manualSelection,
    provider?.manifest.id,
    onSelectProvider,
  ]);

  const scopeKey = `${provider?.manifest.id ?? "none"}::${endpoint?.id ?? "generic"}`;

  const {
    obfuscate,
    clearCache,
    newSeed,
    state,
    overrides,
    valueOverrides,
    setOverride,
    setValueOverride,
    resetOverrides,
    hasSaved,
  } = useObfuscator(scopeKey);

  useEffect(() => {
    setExplicitEndpointId(null);
  }, [provider?.manifest.id]);

  // Surface the detected input format to the parent so the sidebar's
  // "Supported formats" section can highlight whichever format the user just
  // pasted. Clear on unmount (e.g. when switching to Batch mode) so the
  // sidebar doesn't show a stale highlight from a no-longer-visible pane.
  useEffect(() => {
    onDetectedFormatChange?.(parsedInput?.format ?? null);
  }, [parsedInput?.format, onDetectedFormatChange]);
  useEffect(() => {
    return () => onDetectedFormatChange?.(null);
  }, [onDetectedFormatChange]);

  useEffect(() => {
    if (parsedInput === null) {
      setOutputText("");
      setResult(null);
      if (!inputText.trim()) {
        setError(null);
      } else {
        setError(parseError ?? "Input is not valid JSON or XML.");
      }
      return;
    }
    try {
      const res = obfuscate(parsedInput.data, endpoint);
      setOutputText(serialize(res.output, parsedInput));
      setOutputFormat(parsedInput.format);
      setResult(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setOutputText("");
      setResult(null);
    }
  }, [parsedInput, endpoint, obfuscate, inputText, parseError, state.seed]);

  // Line-by-line diff between the re-serialized input and the output. Both
  // run through the same serialize() so line counts match exactly — any line
  // that differs is a line where obfuscation (or a custom override) changed
  // something. Used to draw a small left-edge indicator on those lines.
  const modifiedLines = useMemo<Set<number>>(() => {
    if (!parsedInput || !outputText) return new Set();
    let inputPretty: string;
    try {
      inputPretty = serialize(parsedInput.data, parsedInput);
    } catch {
      return new Set();
    }
    const inLines = inputPretty.split("\n");
    const outLines = outputText.split("\n");
    const set = new Set<number>();
    const n = Math.min(inLines.length, outLines.length);
    for (let i = 0; i < n; i++) {
      if (inLines[i] !== outLines[i]) set.add(i + 1);
    }
    return set;
  }, [parsedInput, outputText]);

  const endpointsForProvider = provider?.endpoints ?? [];

  // useCallback so Splitter's window mousemove/mouseup listeners don't tear
  // down + rebind on every Workspace re-render (every input-pane keystroke).
  const handleInputOutputDrag = useCallback(
    ({ clientX, rect }: { clientX: number; rect: DOMRect }) => {
      const usableRight = fieldsPaneVisible ? rect.right - fieldsPaneWidth - 8 : rect.right;
      const width = usableRight - rect.left;
      if (width <= 0) return;
      const ratio = (clientX - rect.left) / width;
      setSplitRatio(clampSplitRatio(ratio));
    },
    [fieldsPaneVisible, fieldsPaneWidth, setSplitRatio],
  );

  const handleFieldsResize = useCallback(
    ({ clientX, rect }: { clientX: number; rect: DOMRect }) => {
      const w = rect.right - clientX;
      const max = rect.width * MAX_FIELDS_WIDTH_RATIO;
      setFieldsPaneWidth(Math.max(MIN_FIELDS_WIDTH, Math.min(max, w)));
    },
    [setFieldsPaneWidth],
  );

  return (
    <div className="workspace">
      <EndpointBadge
        endpoint={endpoint}
        endpoints={endpointsForProvider}
        detectedFrom={detectedFrom}
        onChange={setExplicitEndpointId}
      />
      <div className="panes" ref={panesRef}>
        <InputEditor
          value={inputText}
          onChange={setInputText}
          urlHint={urlHint}
          onUrlHintChange={setUrlHint}
          onReset={() => {
            setInputText("");
            setUrlHint("");
            setCsvDelimiterOverride(null);
          }}
          onReady={handleInputReady}
          onUpdate={handleInputUpdate}
          format={parsedInput?.format ?? "json"}
          csvDetectedDelimiter={parsedInput?.csvDelimiter ?? null}
          csvDelimiterOverride={csvDelimiterOverride}
          onCsvDelimiterChange={setCsvDelimiterOverride}
          style={{ flexGrow: splitRatio }}
        />
        <Splitter
          containerRef={panesRef}
          onDrag={handleInputOutputDrag}
          onReset={() => setSplitRatio(0.5)}
        />
        <OutputViewer
          value={outputText}
          format={outputFormat}
          error={error}
          onRegenerate={newSeed}
          style={{ flexGrow: 1 - splitRatio }}
          onShowFields={!fieldsPaneVisible && !isStacked ? () => setFieldsPaneVisible(true) : undefined}
          onReady={handleOutputReady}
          onUpdate={handleOutputUpdate}
          linked={linked}
          onToggleLink={() => setLinked((v) => !v)}
          modifiedLines={modifiedLines}
          codegenSample={outputFormat === "json" ? (result?.output ?? null) : null}
        />
        {(fieldsPaneVisible || isStacked) && (
          <>
            <Splitter
              containerRef={panesRef}
              onDrag={handleFieldsResize}
              onReset={() => setFieldsPaneWidth(DEFAULT_FIELDS_WIDTH)}
              title="Drag to resize field panel · double-click to reset"
            />
            <FieldControlsPanel
              fields={result?.fields ?? []}
              stats={result?.stats ?? null}
              overrideCount={overrides.size + valueOverrides.size}
              hasSaved={hasSaved}
              valueOverrides={valueOverrides}
              onToggle={setOverride}
              onSetValueOverride={setValueOverride}
              onReset={resetOverrides}
              onHide={isStacked ? undefined : () => setFieldsPaneVisible(false)}
              style={{ flex: `0 0 ${fieldsPaneWidth}px` }}
            />
          </>
        )}
      </div>
      <SettingsDrawer
        cacheSize={state.cacheSize}
        seed={state.seed}
        onClearCache={clearCache}
      />
    </div>
  );
}
