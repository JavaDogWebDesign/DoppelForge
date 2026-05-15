import { useEffect, useRef, type RefObject } from "react";
import type { EditorView } from "@codemirror/view";

interface Args {
  inputViewRef: RefObject<EditorView | null>;
  outputViewRef: RefObject<EditorView | null>;
}

// Cmd/Ctrl+A inside an editor selects that editor's contents only - not the
// whole page. Tracks last-clicked editor because the read-only output pane
// often doesn't take DOM focus on click, so `e.target` alone isn't enough to
// know which editor a Cmd/Ctrl+A is meant for.
export function useGlobalSelectAll({ inputViewRef, outputViewRef }: Args) {
  const lastFocusedEditorRef = useRef<EditorView | null>(null);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const editorEl = target?.closest?.(".cm-editor") as HTMLElement | null;
      if (!editorEl) return;
      if (inputViewRef.current?.dom === editorEl) {
        lastFocusedEditorRef.current = inputViewRef.current;
      } else if (outputViewRef.current?.dom === editorEl) {
        lastFocusedEditorRef.current = outputViewRef.current;
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [inputViewRef, outputViewRef]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.key === "a" || e.key === "A") && (e.metaKey || e.ctrlKey)) {
        const target = e.target as HTMLElement | null;
        const editorEl = target?.closest?.(".cm-editor") as HTMLElement | null;
        let view: EditorView | null = null;
        if (editorEl) {
          view =
            inputViewRef.current?.dom === editorEl
              ? inputViewRef.current
              : outputViewRef.current?.dom === editorEl
                ? outputViewRef.current
                : null;
        }
        if (!view) view = lastFocusedEditorRef.current;
        if (!view) return;
        e.preventDefault();
        view.dispatch({
          selection: { anchor: 0, head: view.state.doc.length },
        });
        view.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [inputViewRef, outputViewRef]);
}
