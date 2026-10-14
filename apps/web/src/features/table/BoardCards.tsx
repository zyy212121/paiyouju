import { useEffect, useRef } from "react";

import { FlippingPlayingCard } from "../../components/FlippingPlayingCard.js";

export function BoardCards({ cards, compact = false }: { readonly cards: readonly string[]; readonly compact?: boolean }) {
  const previousCount = useRef(cards.length);
  const animateFrom = cards.length > previousCount.current ? previousCount.current : cards.length;
  useEffect(() => { previousCount.current = cards.length; }, [cards.length]);
  return <div aria-label="公共牌" className="flex min-h-16 justify-center gap-1" data-testid="board">{cards.map((card, index) => <FlippingPlayingCard animate={index >= animateFrom} code={card} delayMs={140 + (index - animateFrom) * 140} key={`${card}-${index}`} small={compact} />)}</div>;
}
