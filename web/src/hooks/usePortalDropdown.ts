import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export interface DropdownCoords {
  top: number;
  right: number;
}

interface UsePortalDropdownResult<A extends HTMLElement, P extends HTMLElement> {
  open: boolean;
  setOpen: (next: boolean) => void;
  toggle: () => void;
  /** Attach to the trigger/wrapper element - used for both positioning and outside-click detection. */
  anchorRef: React.RefObject<A | null>;
  /** Attach to the portaled panel element - used for outside-click detection. */
  panelRef: React.RefObject<P | null>;
  /** Anchored panel position, set after the panel opens. Null while closed. */
  coords: DropdownCoords | null;
}

// Shared plumbing for portal-rendered dropdowns anchored to a trigger button:
//
//   - Tracks open/closed state.
//   - Computes panel coords relative to the anchor's bounding rect, top-right
//     aligned 6px below the anchor.
//   - Recomputes on scroll/resize while open so the panel tracks the anchor.
//   - Closes on outside mousedown and Escape.
//
// Caller attaches `anchorRef` to its trigger wrapper, `panelRef` to the
// portaled panel, and uses `coords` to position via `style={{ top, right }}`.
export function usePortalDropdown<
  A extends HTMLElement = HTMLDivElement,
  P extends HTMLElement = HTMLDivElement,
>(): UsePortalDropdownResult<A, P> {
  const [open, setOpenState] = useState(false);
  const [coords, setCoords] = useState<DropdownCoords | null>(null);
  const anchorRef = useRef<A | null>(null);
  const panelRef = useRef<P | null>(null);

  const setOpen = useCallback((next: boolean) => setOpenState(next), []);
  const toggle = useCallback(() => setOpenState((v) => !v), []);

  const recomputeCoords = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setCoords({
      top: rect.bottom + 6,
      right: window.innerWidth - rect.right,
    });
  }, []);

  // Initial position when opening (synchronous so first paint is correct).
  useLayoutEffect(() => {
    if (!open) return;
    recomputeCoords();
  }, [open, recomputeCoords]);

  // Re-track position while open if the anchor moves under scroll/resize.
  useEffect(() => {
    if (!open) return;
    const onScroll = () => recomputeCoords();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, recomputeCoords]);

  // Outside-click + Escape to close. Clicks inside the anchor or the panel
  // bubble up but are ignored here - the trigger's own onClick handles toggle.
  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpenState(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenState(false);
    };
    document.addEventListener("mousedown", onDocPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return { open, setOpen, toggle, anchorRef, panelRef, coords };
}
