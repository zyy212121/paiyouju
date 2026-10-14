import type { HandDetail, HandSummary, HistoryEvent } from "@paiyouju/shared";
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, History, LoaderCircle, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { readableError } from "../../../api/client.js";
import { getHand, listHands } from "../../../api/hands.js";
import { PaidRevealButton } from "../../../components/PaidRevealButton.js";
import { PlayingCard } from "../../../components/PlayingCard.js";
import { HistoryHoleCards } from "../../history/HistoryCards.js";
import { HypotheticalRunoutView } from "../../history/HypotheticalRunoutView.js";
import { useSwipeToClose } from "./useSwipeToClose.js";

const streetLabels = {
  FLOP: "翻牌",
  PREFLOP: "翻牌前",
  RIVER: "河牌",
  SHOWDOWN: "摊牌",
  TURN: "转牌",
} as const;

function compactAction(event: HistoryEvent): string {
  const amount = event.raiseTo ?? event.amount;
  const suffix = amount === null ? "" : ` ${amount.toLocaleString()}`;
  const label = event.type === "BLIND_POSTED" ? "盲注"
    : event.type === "PLAYER_FOLDED" ? "弃牌"
      : event.type === "PLAYER_CHECKED" ? "过牌"
        : event.type === "PLAYER_CALLED" ? "跟注"
          : event.type === "PLAYER_BET" ? "下注"
            : event.type === "PLAYER_RAISED" ? "加注至"
              : event.type === "PLAYER_ALL_IN" ? "全下"
                : null;
  return label ? `${label}${suffix}` : "";
}

function playerActions(detail: HandDetail, userId: string) {
  const grouped = new Map<string, string[]>();
  for (const event of detail.actions) {
    if (event.actorUserId !== userId) continue;
    const label = compactAction(event);
    if (!label) continue;
    const values = grouped.get(event.street) ?? [];
    values.push(label);
    grouped.set(event.street, values);
  }
  return (["PREFLOP", "FLOP", "TURN", "RIVER", "SHOWDOWN"] as const)
    .flatMap((street) => {
      const values = grouped.get(street);
      return values?.length ? [`${streetLabels[street]}：${values.join("、")}`] : [];
    });
}

function seatRoles(detail: HandDetail, seatIndex: number): string {
  return [
    seatIndex === detail.buttonSeat ? "D" : null,
    seatIndex === detail.smallBlindSeat ? "SB" : null,
    seatIndex === detail.bigBlindSeat ? "BB" : null,
  ].filter(Boolean).join(" · ");
}

function HandAuditPage({ detail, onPurchased }: {
  readonly detail: HandDetail;
  readonly onPurchased: () => Promise<void>;
}) {
  const hiddenCount = detail.players.filter((player) => player.holeCardsVisibility === "HIDDEN"
    || player.holeCardsVisibility === "PUBLIC_VOLUNTARY" && player.holeCards.some((card) => card === null)).length;
  const reviewOpen = detail.reviewEndsAt !== null && Date.parse(detail.reviewEndsAt) > Date.now();
  return (
    <div className="history-audit-layout" data-testid="hand-audit-page">
      <div className="history-public-info">
        <p className="text-xs text-stone-500">公共牌</p>
        <div className="mt-2 flex gap-1">
          {detail.board.map((card) => <PlayingCard code={card} key={card} small />)}
          {detail.board.length === 0 && <span className="text-sm text-stone-500">0/5</span>}
        </div>
      </div>
      <div className="table-drawer-scroll mt-3 space-y-2" data-testid="history-player-scroll">
        {detail.players.map((player) => {
          const actions = playerActions(detail, player.userId);
          const roles = seatRoles(detail, player.seatIndex);
          return (
            <article className="rounded-xl bg-black/20 p-3" key={player.userId}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm">{player.nickname} <span className="text-[10px] text-amber-200">{roles}</span></p>
                  <p className={`text-xs ${player.netResult >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{player.netResult >= 0 ? "+" : ""}{player.netResult}</p>
                </div>
                <HistoryHoleCards player={player} />
              </div>
              {actions.length > 0 && <ul className="mt-2 space-y-1 text-[10px] leading-4 text-stone-500">{actions.map((action) => <li key={action}>{action}</li>)}</ul>}
            </article>
          );
        })}
      </div>
      <div className="table-drawer-fixed-footer mt-3 space-y-2" data-testid="history-fixed-controls">
        {hiddenCount > 0 && detail.paidRevealConfig.enabled && detail.paidRevealConfig.cost > 0 && !reviewOpen && (
          <PaidRevealButton cost={detail.paidRevealConfig.cost} handId={detail.handId} onPurchased={onPurchased} />
        )}
        {reviewOpen && hiddenCount > 0 && <p className="rounded-xl bg-amber-300/10 p-3 text-xs text-amber-100">观察期结束后可查看</p>}
        <HypotheticalRunoutView board={detail.board} existingResult={detail.hypotheticalRunout} handId={detail.handId} />
      </div>
    </div>
  );
}

export function HistoryDrawer({ onClose, open, roomId }: {
  readonly onClose: () => void;
  readonly open: boolean;
  readonly roomId: string;
}) {
  const [items, setItems] = useState<readonly HandSummary[]>([]);
  const [index, setIndex] = useState(0);
  const [detail, setDetail] = useState<HandDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRequest = useRef<AbortController | null>(null);
  const detailRequest = useRef<AbortController | null>(null);
  const swipe = useSwipeToClose("right", onClose);

  const loadList = useCallback(async () => {
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    setLoading(true);
    setError(null);
    try {
      const collected: HandSummary[] = [];
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await listHands({
          ...(cursor === undefined ? {} : { cursor }),
          limit: 100,
          roomId,
          signal: controller.signal,
        });
        collected.push(...page.items);
        if (!page.nextCursor) break;
        if (seenCursors.has(page.nextCursor)) throw new Error("历史分页游标重复");
        seenCursors.add(page.nextCursor);
        cursor = page.nextCursor;
      } while (!controller.signal.aborted);
      if (!controller.signal.aborted) {
        setItems(collected);
        setIndex(0);
      }
    } catch (caught: unknown) {
      if (!controller.signal.aborted) setError(readableError(caught));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    if (open) void loadList();
    return () => listRequest.current?.abort();
  }, [loadList, open]);

  const selected = items[index];
  const loadDetail = useCallback(async () => {
    detailRequest.current?.abort();
    if (!selected) { setDetail(null); return; }
    const controller = new AbortController();
    detailRequest.current = controller;
    setLoading(true);
    setError(null);
    try {
      const next = await getHand(selected.handId, selected.runoutIndex, controller.signal);
      if (!controller.signal.aborted) setDetail(next);
    } catch (caught: unknown) {
      if (!controller.signal.aborted) setError(readableError(caught));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    if (open) void loadDetail();
    return () => detailRequest.current?.abort();
  }, [loadDetail, open]);

  const visibleDetail = useMemo(
    () => selected && detail?.handId === selected.handId && detail.runoutIndex === selected.runoutIndex ? detail : null,
    [detail, selected],
  );

  useEffect(() => {
    const reviewEndsAt = visibleDetail?.reviewEndsAt;
    if (!open || !reviewEndsAt) return;
    const remainingMs = Date.parse(reviewEndsAt) - Date.now();
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) return;
    const timer = window.setTimeout(() => { void loadDetail(); }, remainingMs + 50);
    return () => window.clearTimeout(timer);
  }, [loadDetail, open, visibleDetail?.reviewEndsAt]);

  if (!open) return null;

  return (
    <><button aria-label="关闭历史并返回牌桌" className="table-drawer-backdrop" onClick={onClose} type="button" /><aside aria-label="牌桌历史抽屉" aria-busy={loading} className="table-drawer table-drawer-right" data-testid="history-drawer" {...swipe}>
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2"><History size={18} /><h2 className="font-semibold">本桌历史</h2></div>
        <button aria-label="关闭历史" className="table-icon-button" onClick={onClose} type="button"><X /></button>
      </header>
      {error && <p className="mt-3 text-sm text-rose-300" role="alert">{error}</p>}
      {loading && items.length === 0 ? <div className="grid min-h-48 place-items-center"><LoaderCircle className="animate-spin" /></div> : items.length === 0 ? <p className="mt-8 text-center text-sm text-stone-500">本桌还没有已结算手牌</p> : (
        <>
          <nav aria-label="手牌翻页" className="mt-4 grid grid-cols-5 items-center gap-1">
            <button aria-label="第一手" className="table-icon-button" disabled={index === items.length - 1} onClick={() => setIndex(items.length - 1)} type="button"><ChevronFirst /></button>
            <button aria-label="上一手" className="table-icon-button" disabled={index >= items.length - 1} onClick={() => setIndex((value) => Math.min(items.length - 1, value + 1))} type="button"><ChevronLeft /></button>
            <span className="text-center text-xs">{items.length - index}/{items.length}</span>
            <button aria-label="下一手" className="table-icon-button" disabled={index === 0} onClick={() => setIndex((value) => Math.max(0, value - 1))} type="button"><ChevronRight /></button>
            <button aria-label="最后一手" className="table-icon-button" disabled={index === 0} onClick={() => setIndex(0)} type="button"><ChevronLast /></button>
          </nav>
          <div className="history-detail-shell mt-4 border-t border-white/10 pt-4">
            <h3 className="mb-3 text-sm font-medium">第 {selected?.displayHandNumber} 手</h3>
            {loading && !visibleDetail ? <div className="grid min-h-40 place-items-center"><LoaderCircle className="animate-spin" /></div> : visibleDetail && <HandAuditPage detail={visibleDetail} onPurchased={loadDetail} />}
          </div>
        </>
      )}
    </aside></>
  );
}
