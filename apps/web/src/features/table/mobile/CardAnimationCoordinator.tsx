import type { ProjectedHand } from "@paiyouju/shared";
import { useEffect, useRef, useState } from "react";

interface AnimationBatch {
  readonly count: number;
  readonly id: number;
}

export function CardAnimationCoordinator({ hand, seatedPlayers }: {
  readonly hand: ProjectedHand | null;
  readonly seatedPlayers: number;
}) {
  const previous = useRef<{ readonly board: number; readonly handId: string | null } | null>(null);
  const sequence = useRef(0);
  const [batch, setBatch] = useState<AnimationBatch | null>(null);
  useEffect(() => {
    const discardWhileHidden = () => { if (document.visibilityState === "hidden") setBatch(null); };
    document.addEventListener("visibilitychange", discardWhileHidden);
    return () => document.removeEventListener("visibilitychange", discardWhileHidden);
  }, []);
  useEffect(() => {
    const current = { board: hand?.board.length ?? 0, handId: hand?.handId ?? null };
    const prior = previous.current;
    previous.current = current;
    if (!prior) return;
    if (document.visibilityState === "hidden" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setBatch(null);
      return;
    }
    let next: AnimationBatch | null = null;
    if (current.handId && current.handId !== prior.handId) next = { count: Math.max(4, seatedPlayers * 2), id: ++sequence.current };
    if (!next) return;
    setBatch(next);
    const timer = window.setTimeout(() => setBatch((value) => value?.id === next.id ? null : value), 900);
    return () => window.clearTimeout(timer);
  }, [hand?.board.length, hand?.handId, seatedPlayers]);
  if (!batch) return null;
  return <div aria-hidden="true" className="card-animation-layer deal" data-animation-kind="deal" data-testid="card-animation-layer">{Array.from({ length: batch.count }, (_, index) => <span className="flying-card-back" key={`${batch.id}-${index}`} style={{ "--card-delay": `${index * 35}ms`, "--card-x": `${(index - Math.floor(batch.count / 2)) * 12}px` } as React.CSSProperties} />)}</div>;
}
