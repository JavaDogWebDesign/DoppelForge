import { useCallback, useEffect, useRef, type RefObject } from "react";

interface DragInfo {
  clientX: number;
  rect: DOMRect;
}

interface Props {
  containerRef: RefObject<HTMLDivElement | null>;
  onDrag: (info: DragInfo) => void;
  onReset?: () => void;
  title?: string;
}

export function Splitter({ containerRef, onDrag, onReset, title }: Props) {
  const draggingRef = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (!draggingRef.current || !containerRef.current) return;
      onDrag({ clientX: e.clientX, rect: containerRef.current.getBoundingClientRect() });
    }
    function handleMouseUp() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [onDrag, containerRef]);

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      onMouseDown={handleMouseDown}
      onDoubleClick={onReset}
      title={title ?? "Drag to resize · double-click to reset"}
    />
  );
}
