import { useRef, type PointerEventHandler } from "react";

const INTERACTIVE_SELECTOR = "button, a[href], input, select, textarea, summary, [role='button'], [role='tab'], [contenteditable='true'], [data-swipe-ignore]";

function startsOnInteractiveControl(event: Parameters<PointerEventHandler<HTMLElement>>[0]): boolean {
  return event.target instanceof Element && event.target.closest(INTERACTIVE_SELECTOR) !== null;
}

export function useSwipeToClose(side: "left" | "right", onClose: () => void) {
  const start = useRef<{ readonly x: number; readonly y: number } | null>(null);
  const isClosingGesture = (origin: { readonly x: number; readonly y: number }, x: number, y: number) => {
    const horizontal = x - origin.x;
    const vertical = y - origin.y;
    if (Math.abs(horizontal) < 72 || Math.abs(horizontal) <= Math.abs(vertical) * 1.2) return false;
    return (side === "left" && horizontal < 0) || (side === "right" && horizontal > 0);
  };
  const releasePointer = (event: Parameters<PointerEventHandler<HTMLElement>>[0]) => {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const onPointerDown: PointerEventHandler<HTMLElement> = (event) => {
    if (startsOnInteractiveControl(event)) {
      start.current = null;
      return;
    }
    start.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove: PointerEventHandler<HTMLElement> = (event) => {
    const origin = start.current;
    if (!origin || !isClosingGesture(origin, event.clientX, event.clientY)) return;
    start.current = null;
    releasePointer(event);
    onClose();
  };
  const onPointerUp: PointerEventHandler<HTMLElement> = (event) => {
    const origin = start.current;
    start.current = null;
    releasePointer(event);
    if (origin && isClosingGesture(origin, event.clientX, event.clientY)) onClose();
  };
  const onPointerCancel: PointerEventHandler<HTMLElement> = (event) => {
    start.current = null;
    releasePointer(event);
  };
  return { onPointerCancel, onPointerDown, onPointerMove, onPointerUp };
}
