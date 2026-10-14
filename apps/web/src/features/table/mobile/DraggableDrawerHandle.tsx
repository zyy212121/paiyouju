import { useEffect, useRef, useState, type ReactNode } from "react";

function storedTop(storageKey: string): number | null {
  const value = window.localStorage.getItem(`wepoker:${storageKey}:top`);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function DraggableDrawerHandle({ ariaLabel, children, onClick, side, storageKey }: {
  readonly ariaLabel: string;
  readonly children: ReactNode;
  readonly onClick: () => void;
  readonly side: "left" | "right";
  readonly storageKey: string;
}) {
  const [top, setTop] = useState<number | null>(() => storedTop(storageKey));
  const button = useRef<HTMLButtonElement | null>(null);
  const drag = useRef<{ currentTop: number; moved: boolean; startTop: number; startY: number } | null>(null);
  const removeWindowListeners = useRef<() => void>(() => undefined);
  const suppressClick = useRef(false);
  const suppressResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    removeWindowListeners.current();
    if (suppressResetTimer.current) clearTimeout(suppressResetTimer.current);
  }, []);

  const cancelDrag = () => {
    removeWindowListeners.current();
    removeWindowListeners.current = () => undefined;
    drag.current = null;
  };
  const moveDrag = (clientY: number) => {
    const active = drag.current;
    if (!active) return;
    const delta = clientY - active.startY;
    if (Math.abs(delta) > 5) active.moved = true;
    const next = Math.round(Math.max(64, Math.min(window.innerHeight - 88, active.startTop + delta)));
    active.currentTop = next;
    if (active.moved) {
      // Keep the handle under the pointer immediately. WebKit may defer React's
      // state commit until after mouseup, which otherwise makes a completed drag
      // look as if it never moved.
      button.current?.style.setProperty("top", `${next}px`);
      setTop(next);
    }
  };
  const finishDrag = () => {
    const active = drag.current;
    cancelDrag();
    if (!active?.moved) return;
    suppressClick.current = true;
    if (suppressResetTimer.current) clearTimeout(suppressResetTimer.current);
    suppressResetTimer.current = setTimeout(() => {
      suppressClick.current = false;
      suppressResetTimer.current = null;
    }, 0);
    window.localStorage.setItem(`wepoker:${storageKey}:top`, String(active.currentTop));
  };
  const beginDrag = (clientY: number) => {
    cancelDrag();
    const startTop = top ?? window.innerHeight * 0.47;
    drag.current = { currentTop: startTop, moved: false, startTop, startY: clientY };
    const onMove = (moveEvent: MouseEvent | PointerEvent) => moveDrag(moveEvent.clientY);
    const onUp = () => finishDrag();
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp, { once: true });
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    removeWindowListeners.current = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  };
  return <button
    aria-label={ariaLabel}
    className={`drawer-handle drawer-handle-${side}`}
    onClick={(event) => {
      if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); return; }
      onClick();
    }}
    onMouseDown={(event) => beginDrag(event.clientY)}
    onPointerCancel={cancelDrag}
    onPointerDown={(event) => beginDrag(event.clientY)}
    ref={button}
    style={top === null ? undefined : { top: `${top}px` }}
    type="button"
  >{children}</button>;
}
