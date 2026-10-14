import type { TableStateProjection } from "@paiyouju/shared";

export function HandInfoPanel({ connection, state }: {
  readonly connection: "connected" | "reconnecting" | "disconnected";
  readonly state: TableStateProjection;
}) {
  const hand = state.hand;
  const seatName = (seatIndex: number | undefined) => {
    if (seatIndex === undefined) return "—";
    return state.seats.find((seat) => seat.seatIndex === seatIndex)?.nickname ?? `座位 ${seatIndex + 1}`;
  };
  const dealer = state.seats.find((seat) => seat.isDealer)?.seatIndex;
  const smallBlind = state.seats.find((seat) => seat.isSmallBlind)?.seatIndex;
  const bigBlind = state.seats.find((seat) => seat.isBigBlind)?.seatIndex;
  return (
    <details className="panel !p-0">
      <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-medium">牌局信息</summary>
      <dl className="grid gap-3 border-t border-white/10 px-4 py-4 text-xs sm:grid-cols-2 lg:grid-cols-3">
        <Info label="房间" value={`${state.room.name} #${state.room.roomCode}`} />
        <Info label="Hand" value={hand ? `${hand.handNumber} · ${hand.handId}` : "尚未开始"} />
        <Info label="盲注" value={`${state.room.smallBlind.toLocaleString()} / ${state.room.bigBlind.toLocaleString()}`} />
        <Info label="庄位 / 小盲 / 大盲" value={`${seatName(dealer)} / ${seatName(smallBlind)} / ${seatName(bigBlind)}`} />
        <Info label="街道" value={hand?.street ?? "—"} />
        <Info label="底池" value={hand ? `主池 ${hand.mainPot.toLocaleString()} · 边池 ${hand.sidePots.map((pot) => pot.toLocaleString()).join(" / ") || "无"}` : "—"} />
        <Info label="开手筹码" value={state.seats.map((seat) => `${seat.nickname} ${seat.startingStack?.toLocaleString() ?? "—"}`).join(" · ") || "—"} />
        <Info label="当前筹码" value={state.seats.map((seat) => `${seat.nickname} ${seat.stack.toLocaleString()}`).join(" · ") || "—"} />
        <Info label="行动历史" value={`${hand?.actionHistory.length ?? 0} 条（见行动记录）`} />
        <Info label="连接 / Runtime" value={`${connection} / ${state.runtimeStatus}`} />
        {import.meta.env.DEV && <Info label="State Version（开发）" value={state.stateVersion.toLocaleString()} />}
      </dl>
    </details>
  );
}

function Info({ label, value }: { readonly label: string; readonly value: string }) {
  return <div className="min-w-0"><dt className="text-stone-500">{label}</dt><dd className="mt-1 break-words text-stone-200">{value}</dd></div>;
}
