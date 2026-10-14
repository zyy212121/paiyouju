import type { TableStateProjection } from "@paiyouju/shared";
import { Countdown } from "../../../components/Countdown.js";
import { SquidBadge } from "./SquidBadge.js";

export function PostHandReviewOverlay({ state }: {
  readonly state: TableStateProjection;
}) {
  const squidRoundTransition = state.room.specialMode === "SQUID" && state.room.squidRoundGraceEndsAt !== null;
  if (state.runtimeStatus !== "POST_HAND_REVIEW" && !squidRoundTransition) return null;
  const ownNet = state.lastHandSummary?.ownNetResult;
  const won = state.lastHandSummary?.winnerUserIds.includes(state.recipient.userId) ?? false;
  if (squidRoundTransition) {
    return <section aria-label="新一轮鱿鱼争夺" className="post-hand-review squid-round-transition" data-testid="squid-round-transition"><div className="squid-round-title"><SquidBadge className="squid-round-badge" /><div><p className="text-[10px] uppercase tracking-[.2em] text-cyan-100/70">新一轮鱿鱼争夺</p><p className="text-sm font-black text-cyan-50">第 {state.room.squidRoundNumber} 轮</p></div></div>{state.runtimeStatus === "POST_HAND_REVIEW" && ownNet !== null && ownNet !== undefined && <p className={`mt-1 text-lg font-bold ${ownNet >= 0 ? "text-emerald-200" : "text-rose-200"}`}>本手 {ownNet >= 0 ? "+" : ""}{ownNet}</p>}<p className="mt-1 text-xs font-semibold text-amber-100">本轮结算后 10 秒内可无惩罚站起</p><p className="mt-1 text-xs text-stone-400">下一手将在 <Countdown deadline={state.room.squidRoundGraceEndsAt} /> 后开始</p></section>;
  }
  return <section aria-label="结算观察期" className="post-hand-review" data-testid="post-hand-review"><p className="text-[10px] uppercase tracking-[.2em] text-amber-200/70">结算观察期</p>{won && <p className="mt-1 text-sm font-black tracking-[.18em] text-amber-200">YOU WIN!</p>}<p className={`mt-1 text-2xl font-bold ${(ownNet ?? 0) >= 0 ? "text-emerald-200" : "text-rose-200"}`}>{ownNet === null || ownNet === undefined ? "本手已结束" : `${ownNet >= 0 ? "+" : ""}${ownNet}`}</p><p className="mt-1 text-xs text-stone-400">下一手将在 <Countdown deadline={state.postHandReviewEndsAt} /> 后直接开始</p></section>;
}
