import type { HandDetailPlayer } from "@paiyouju/shared";

import { CardBack, PlayingCard } from "../../components/PlayingCard.js";

export function HistoryHoleCards({ player }: { readonly player: HandDetailPlayer }) {
  if (player.holeCardsVisibility === "HIDDEN") return <div className="flex -space-x-1" data-visibility="HIDDEN"><CardBack small /><CardBack small /></div>;
  return <div className="grid justify-items-center gap-1" data-visibility={player.holeCardsVisibility}><div className="flex -space-x-1">{player.holeCards.map((card, index) => card ? <PlayingCard code={card} key={card} small /> : <CardBack key={`hidden-${index}`} small />)}</div>{player.handLabel && <span className="text-[10px] font-semibold text-amber-200">{player.handLabel}</span>}</div>;
}
