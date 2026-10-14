import type { ReplayState } from "@paiyouju/shared";

import { CardBack, PlayingCard } from "../../components/PlayingCard.js";

export function ReplayTable({ state }: { readonly state: ReplayState }) {
  return (
    <section className="replay-table" data-testid="replay-table">
      <div className="flex min-h-16 justify-center gap-1" data-testid="replay-board">
        {state.board.map((card, index) => <PlayingCard code={card} key={`${card}-${index}`} />)}
      </div>
      <p className="mt-3 text-center text-sm text-amber-200">底池 {state.pot.toLocaleString()} · {state.street}</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {state.players.map((player) => <article className={`rounded-xl border p-3 ${player.folded ? "border-white/10 opacity-60" : state.winners.includes(player.userId) ? "border-emerald-300/50 bg-emerald-300/10" : "border-white/15 bg-black/20"}`} key={player.userId}>
          <div className="flex items-start justify-between gap-2"><div><p className="font-medium">{player.nickname}</p><p className="text-xs text-stone-400">座位 {player.seatIndex + 1} · 筹码 {player.stack.toLocaleString()}</p><p className="text-xs text-stone-500">投入 {player.committed.toLocaleString()}{player.allIn ? " · 全下" : ""}{player.folded ? " · 已弃牌" : ""}</p></div><div className="flex -space-x-1" data-player-cards={player.userId}>{player.holeCards ? player.holeCards.map((card) => <PlayingCard code={card} key={card} small />) : <><CardBack small /><CardBack small /></>}</div></div>
        </article>)}
      </div>
    </section>
  );
}
