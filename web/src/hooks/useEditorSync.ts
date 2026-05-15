import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import type { StateEffect } from "@codemirror/state";
import { foldEffect, unfoldEffect, foldedRanges } from "@codemirror/language";

interface ScrollSyncArgs {
  inputViewRef: RefObject<EditorView | null>;
  outputViewRef: RefObject<EditorView | null>;
  enabled: boolean;
  // Re-binding trigger: when output text changes, the output editor's scroll
  // height changes too; rebind so ratios recompute against the new geometry.
  rebindKey: unknown;
}

// Mirror scroll position between two editors when `enabled`. Coalesces via
// rAF; suppresses only the target's echoed scroll so a fast source scroll
// overlapping the echo isn't dropped (was the cause of post-bounce drift).
export function useScrollSync({
  inputViewRef,
  outputViewRef,
  enabled,
  rebindKey,
}: ScrollSyncArgs) {
  useEffect(() => {
    if (!enabled) return;
    const iv = inputViewRef.current;
    const ov = outputViewRef.current;
    if (!iv || !ov) return;

    let ignoreScrollFrom: HTMLElement | null = null;
    let pendingSrc: EditorView | null = null;
    let scheduled = false;

    const flushScroll = () => {
      scheduled = false;
      const src = pendingSrc;
      pendingSrc = null;
      if (!src) return;
      const dst = src === iv ? ov : iv;
      const srcDom = src.scrollDOM;
      const dstDom = dst.scrollDOM;
      const srcMax = Math.max(1, srcDom.scrollHeight - srcDom.clientHeight);
      const dstMax = Math.max(0, dstDom.scrollHeight - dstDom.clientHeight);
      const ratio = srcDom.scrollTop / srcMax;
      ignoreScrollFrom = dstDom;
      dstDom.scrollTop = ratio * dstMax;
    };

    const queueScroll = (src: EditorView) => {
      if (ignoreScrollFrom === src.scrollDOM) {
        ignoreScrollFrom = null;
        return;
      }
      pendingSrc = src;
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(flushScroll);
      }
    };

    const onInputScroll = () => queueScroll(iv);
    const onOutputScroll = () => queueScroll(ov);

    iv.scrollDOM.addEventListener("scroll", onInputScroll, { passive: true });
    ov.scrollDOM.addEventListener("scroll", onOutputScroll, { passive: true });

    return () => {
      iv.scrollDOM.removeEventListener("scroll", onInputScroll);
      ov.scrollDOM.removeEventListener("scroll", onOutputScroll);
    };
  }, [enabled, rebindKey, inputViewRef, outputViewRef]);
}

interface CursorSyncArgs {
  inputViewRef: RefObject<EditorView | null>;
  outputViewRef: RefObject<EditorView | null>;
  rebindKey: unknown;
}

// Mirror the active line between editors. Independent of the link toggle -
// the highlighted row tracks across panes whether or not scroll is linked.
//
// Two transport mechanisms because the panes behave differently:
//
//   Input → output (handleInputUpdate, returned). Hooked into onUpdate.
//   CodeMirror dispatches selection transactions synchronously on click /
//   keyboard / programmatic moves, so onUpdate fires the moment selection
//   changes - no waiting on mouseup/keyup, which was the visible lag.
//
//   Output → input (mousedown + posAtCoords). The output pane is
//   editable={false}; contenteditable is off, so clicks never reach CM's
//   selection state. We compute the line from screen coordinates and
//   dispatch onto both panes so the output's own active-line decoration
//   also appears.
export function useCursorSync({
  inputViewRef,
  outputViewRef,
  rebindKey,
}: CursorSyncArgs) {
  const suppressRef = useRef(false);

  // Move `view`'s active line to `lineNumber` (1-based). Bails out when the
  // target is already current - keeps us from re-dispatching on every
  // intra-line keystroke and from chasing our own echo.
  const setActiveLine = useCallback(
    (view: EditorView, lineNumber: number) => {
      const total = view.state.doc.lines;
      if (total < 1) return;
      const target = Math.min(Math.max(1, lineNumber), total);
      const head = view.state.selection.main.head;
      if (view.state.doc.lineAt(head).number === target) return;
      const lineObj = view.state.doc.line(target);
      view.dispatch({
        selection: { anchor: lineObj.from },
        scrollIntoView: false,
      });
    },
    [],
  );

  useEffect(() => {
    const ov = outputViewRef.current;
    if (!ov) return;

    const onOutputMouseDown = (e: MouseEvent) => {
      if (suppressRef.current) return;
      const iv = inputViewRef.current;
      if (!iv) return;
      const pos = ov.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos == null) return;
      suppressRef.current = true;
      const line = ov.state.doc.lineAt(pos).number;
      setActiveLine(ov, line);
      setActiveLine(iv, line);
      requestAnimationFrame(() => {
        suppressRef.current = false;
      });
    };

    ov.dom.addEventListener("mousedown", onOutputMouseDown);
    return () => {
      ov.dom.removeEventListener("mousedown", onOutputMouseDown);
    };
  }, [rebindKey, inputViewRef, outputViewRef, setActiveLine]);

  const handleInputUpdate = useCallback(
    (update: ViewUpdate) => {
      if (!update.selectionSet) return;
      if (suppressRef.current) return;
      const ov = outputViewRef.current;
      if (!ov) return;
      const head = update.state.selection.main.head;
      const line = update.state.doc.lineAt(head).number;
      suppressRef.current = true;
      setActiveLine(ov, line);
      requestAnimationFrame(() => {
        suppressRef.current = false;
      });
    },
    [outputViewRef, setActiveLine],
  );

  return { handleInputUpdate };
}

interface FoldSyncArgs {
  inputViewRef: RefObject<EditorView | null>;
  outputViewRef: RefObject<EditorView | null>;
  linkedRef: RefObject<boolean>;
}

// Returns two ViewUpdate handlers (for input and output editors) that mirror
// fold state across the pair when `linkedRef.current` is true. Caller wires
// these into <CodeMirror onUpdate={...}> on each editor.
export function useFoldSync({
  inputViewRef,
  outputViewRef,
  linkedRef,
}: FoldSyncArgs) {
  const suppressRef = useRef(false);

  const syncFolds = useCallback((from: EditorView, to: EditorView) => {
    const effects: StateEffect<unknown>[] = [];

    // Unfold everything currently folded in target.
    const targetFolds = foldedRanges(to.state);
    targetFolds.between(0, to.state.doc.length, (start, end) => {
      effects.push(unfoldEffect.of({ from: start, to: end }));
    });

    // Translate source folds via line numbers (input and output share
    // identical line counts because obfuscation preserves structure).
    const sourceFolds = foldedRanges(from.state);
    const targetLines = to.state.doc.lines;
    sourceFolds.between(0, from.state.doc.length, (start, end) => {
      const startLine = from.state.doc.lineAt(start).number;
      const endLine = from.state.doc.lineAt(end).number;
      if (startLine > targetLines || endLine > targetLines) return;
      // Fold from end of opening line to start of closing line - same shape
      // CodeMirror's JSON fold range uses by default.
      const tStart = to.state.doc.line(startLine).to;
      const tEnd = to.state.doc.line(endLine).from;
      if (tStart < tEnd) effects.push(foldEffect.of({ from: tStart, to: tEnd }));
    });

    if (effects.length > 0) {
      to.dispatch({ effects });
    }
  }, []);

  const handleInputUpdate = useCallback(
    (update: ViewUpdate) => {
      if (!linkedRef.current) return;
      if (suppressRef.current) return;
      const foldChanged = update.transactions.some((tr) =>
        tr.effects.some((e) => e.is(foldEffect) || e.is(unfoldEffect)),
      );
      if (!foldChanged) return;
      const src = inputViewRef.current;
      const dst = outputViewRef.current;
      if (!src || !dst) return;
      suppressRef.current = true;
      syncFolds(src, dst);
      requestAnimationFrame(() => {
        suppressRef.current = false;
      });
    },
    [syncFolds, inputViewRef, outputViewRef, linkedRef],
  );

  const handleOutputUpdate = useCallback(
    (update: ViewUpdate) => {
      if (!linkedRef.current) return;
      if (suppressRef.current) return;
      const foldChanged = update.transactions.some((tr) =>
        tr.effects.some((e) => e.is(foldEffect) || e.is(unfoldEffect)),
      );
      if (!foldChanged) return;
      const src = outputViewRef.current;
      const dst = inputViewRef.current;
      if (!src || !dst) return;
      suppressRef.current = true;
      syncFolds(src, dst);
      requestAnimationFrame(() => {
        suppressRef.current = false;
      });
    },
    [syncFolds, inputViewRef, outputViewRef, linkedRef],
  );

  return { handleInputUpdate, handleOutputUpdate };
}
