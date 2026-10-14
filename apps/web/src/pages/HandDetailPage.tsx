import type { HandDetail, HistoryEvent } from "@paiyouju/shared";
import { ArrowLeft, LoaderCircle, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { readableError } from "../api/client.js";
import { getHand } from "../api/hands.js";
import { PaidRevealButton } from "../components/PaidRevealButton.js";
import { PlayingCard } from "../components/PlayingCard.js";
import { PokerChip } from "../components/PokerChip.js";
import { HistoryHoleCards } from "../features/history/HistoryCards.js";
import { HypotheticalRunoutView } from "../features/history/HypotheticalRunoutView.js";
import { formatDateTime, historyEventLabel, signedPoints } from "../features/history/history-format.js";
import { useNetworkStore } from "../stores/network-store.js";

const streets = ["PREFLOP", "FLOP", "TURN", "RIVER", "SHOWDOWN"] as const;
const streetLabels: Readonly<Record<(typeof streets)[number], string>> = {
  FLOP: "翻牌",
  PREFLOP: "翻牌前",
  RIVER: "河牌",
  SHOWDOWN: "摊牌与结算",
  TURN: "转牌",
};

export function HandDetailPage() {
  const { handId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const runoutIndex = searchParams.get("runoutIndex") === "1" ? 1 : searchParams.get("runoutIndex") === "2" ? 2 : null;
  const [hand, setHand] = useState<HandDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const selectionKey = `${handId}:${runoutIndex ?? 0}`;
  const activeSelection = useRef(selectionKey);
  const mounted = useRef(true);
  const requestEpoch = useRef(0);
  activeSelection.current = selectionKey;
  const refreshVersion = useNetworkStore((state) => state.refreshVersion);
  const load = useCallback(async () => {
    const requestedHandId = handId;
    const requestedSelection = selectionKey;
    if (!mounted.current || activeSelection.current !== requestedSelection) return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const epoch = ++requestEpoch.current;
    setHand((current) => current?.handId === handId && (runoutIndex === null || current.runoutIndex === runoutIndex) ? current : null);
    setError(null);
    try {
      const nextHand = await getHand(requestedHandId, runoutIndex, controller.signal);
      if (controller.signal.aborted || epoch !== requestEpoch.current || !mounted.current || activeSelection.current !== requestedSelection || nextHand.handId !== requestedHandId || (runoutIndex !== null && nextHand.runoutIndex !== runoutIndex)) return;
      setHand(nextHand);
    } catch (caught: unknown) {
      if (!controller.signal.aborted && epoch === requestEpoch.current && mounted.current && activeSelection.current === requestedSelection) setError(readableError(caught));
    }
  }, [handId, runoutIndex, selectionKey]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    void load();
    return () => activeRequest.current?.abort();
  }, [load, refreshVersion]);

  const visibleHand = hand?.handId === handId && (runoutIndex === null || hand.runoutIndex === runoutIndex) ? hand : null;

  useEffect(() => {
    const reviewEndsAt = visibleHand?.reviewEndsAt;
    if (!reviewEndsAt) return;
    const remainingMs = Date.parse(reviewEndsAt) - Date.now();
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) return;
    const timer = window.setTimeout(() => { void load(); }, remainingMs + 50);
    return () => window.clearTimeout(timer);
  }, [load, visibleHand?.reviewEndsAt]);

  const names = useMemo(() => new Map(visibleHand?.players.map((player) => [player.userId, player.nickname]) ?? []), [visibleHand]);
  const actionsByStreet = useMemo(() => {
    const grouped = new Map<(typeof streets)[number], HistoryEvent[]>();
    for (const street of streets) grouped.set(street, []);
    for (const event of visibleHand?.actions ?? []) grouped.get(event.street)?.push(event);
    return grouped;
  }, [visibleHand]);

  if (!visibleHand) return error ? <p className="error-banner" role="alert">{error}</p> : <div className="grid min-h-64 place-items-center" role="status"><LoaderCircle aria-hidden="true" className="animate-spin" /> <span className="sr-only">正在加载手牌详情</span></div>;
  const currentHand = visibleHand;
  const hiddenPlayers = currentHand.players.filter((player) => player.holeCardsVisibility === "HIDDEN");
  const reviewOpen = currentHand.reviewEndsAt !== null && Date.parse(currentHand.reviewEndsAt) > Date.now();
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link className="inline-flex items-center gap-2 text-sm text-stone-300" to="/hands"><ArrowLeft size={16} /> 返回历史</Link>
        {currentHand.runoutIndex === null && <Link className="primary-button gap-2" to={`/hands/${currentHand.handId}/replay`}><Play size={17} /> 回放</Link>}
      </div>
      {error && <p className="error-banner" role="alert">{error}</p>}
      <header className="panel flex flex-wrap justify-between gap-4">
        <div><p className="eyebrow">{currentHand.room.roomName} #{currentHand.room.roomCode}</p><h1 className="text-2xl font-semibold">第 {currentHand.displayHandNumber} 手</h1><p className="mt-1 text-sm text-stone-400">{formatDateTime(currentHand.startedAt)} · {currentHand.finishReason === "SHOWDOWN" ? "摊牌" : "弃牌结束"} · {currentHand.bombPotBlindAmount ? `暴击盲注 ${currentHand.bombPotBlindAmount}/人` : `盲注 ${currentHand.smallBlindAmount}/${currentHand.bigBlindAmount}`}</p></div>
        {currentHand.ownResult !== null && <div className="text-right"><p className="text-xs text-stone-400">我的结果</p><p className={`text-2xl font-bold ${currentHand.ownResult >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{signedPoints(currentHand.ownResult)}</p></div>}
        <div className="w-full"><p className="mb-2 text-xs text-stone-500">公共牌</p><div className="flex gap-1">{currentHand.board.map((card) => <PlayingCard code={card} key={card} />)}{currentHand.board.length === 0 && <span className="text-sm text-stone-500">0/5</span>}</div></div>
      </header>

      <div className="grid gap-3 md:grid-cols-2">
        {currentHand.players.map((player) => (
          <article className="panel flex items-center justify-between gap-3" key={`${currentHand.handId}:${player.userId}`}>
            <div><p className="font-medium">{player.nickname} <span className="text-xs text-stone-500">座位 {player.seatIndex + 1}</span></p><p className="mt-1 text-xs text-stone-400">{player.startingStack.toLocaleString()} → {player.endingStack.toLocaleString()} · {signedPoints(player.netResult)}</p><p className="text-xs text-stone-500">投入 {player.committed.toLocaleString()}{player.folded ? " · 已弃牌" : ""}{player.allIn ? " · 全下" : ""}</p></div>
            <HistoryHoleCards player={player} />
          </article>
        ))}
      </div>

      {hiddenPlayers.length > 0 && currentHand.paidRevealConfig.enabled && currentHand.paidRevealConfig.cost > 0 && !reviewOpen && <section className="panel"><h2 className="section-title">偷偷看</h2><PaidRevealButton cost={currentHand.paidRevealConfig.cost} handId={currentHand.handId} onPurchased={load} /></section>}
      {reviewOpen && hiddenPlayers.length > 0 && <p className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">观察期结束后可查看</p>}

      <HypotheticalRunoutView board={currentHand.board} existingResult={currentHand.hypotheticalRunout} handId={currentHand.handId} />

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <section className="panel"><h2 className="section-title">行动记录</h2><div className="mt-4 space-y-5">{streets.map((street) => { const events = actionsByStreet.get(street) ?? []; return events.length > 0 && <section key={street}><h3 className="text-xs font-semibold text-amber-200">{streetLabels[street]}</h3><ol className="mt-2 space-y-2">{events.map((event) => <li className="border-l border-white/10 pl-3 text-sm text-stone-300" key={event.sequence}>{historyEventLabel(event, names)}</li>)}</ol></section>; })}</div></section>
        <aside className="panel"><h2 className="section-title">底池结算</h2><dl className="mt-3 grid grid-cols-3 gap-2 text-xs text-stone-400"><div><dt>总投入</dt><dd>{currentHand.settlement.totalCommitted.toLocaleString()}</dd></div><div><dt>底池合计</dt><dd>{currentHand.settlement.totalPot.toLocaleString()}</dd></div><div><dt>赢家数</dt><dd>{currentHand.settlement.winnerUserIds.length}</dd></div></dl><div className="mt-4 space-y-3">{currentHand.pots.map((pot) => <div className="rounded-xl bg-black/20 p-3 text-sm" key={pot.potIndex}><PokerChip amount={pot.amount} label={`底池 ${pot.potIndex + 1}`} /><p className="mt-1 text-xs text-stone-400">赢家：{pot.winners.map((id) => names.get(id) ?? "玩家").join("、")}</p>{pot.oddChipRecipients.length > 0 && <p className="text-xs text-amber-200">单数筹码：{pot.oddChipRecipients.map((id) => names.get(id) ?? "玩家").join("、")}</p>}</div>)}</div></aside>
      </div>
    </section>
  );
}
