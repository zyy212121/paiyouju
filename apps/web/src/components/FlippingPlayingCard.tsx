import { useEffect, useState } from "react";

import { CardBack, PlayingCard, type CardSize } from "./PlayingCard.js";

export function FlippingPlayingCard({ animate, code, delayMs = 0, highlighted = false, size = "normal", small = false, testId = "board-card" }: {
  readonly animate: boolean;
  readonly code: string;
  readonly delayMs?: number;
  readonly highlighted?: boolean;
  readonly size?: CardSize;
  readonly small?: boolean;
  readonly testId?: string;
}) {
  const [faceUp, setFaceUp] = useState(!animate);

  useEffect(() => {
    if (!animate || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setFaceUp(true);
      return;
    }
    setFaceUp(false);
    const timer = window.setTimeout(() => setFaceUp(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [animate, code, delayMs]);

  return <span className={`flipping-card ${small ? "is-compact" : size === "large" ? "is-large" : ""}`} data-face-up={String(faceUp)} data-testid={testId}><span className={`flipping-card-inner ${faceUp ? "is-face-up" : ""}`}><span className="flipping-card-side flipping-card-back"><CardBack highlighted={highlighted} size={size} small={small} /></span><span className="flipping-card-side flipping-card-front"><PlayingCard code={code} highlighted={highlighted} size={size} small={small} /></span></span></span>;
}
