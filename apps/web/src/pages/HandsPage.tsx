import type { HandSummary } from "@paiyouju/shared";
import { Filter, LoaderCircle, Spade } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { readableError } from "../api/client.js";
import { listGames } from "../api/games.js";
import { listHands } from "../api/hands.js";
import { PlayingCard } from "../components/PlayingCard.js";
import { formatDateTime, signedPoints } from "../features/history/history-format.js";
import { useNetworkStore } from "../stores/network-store.js";

function localDayBoundary(value: string, end: boolean): string {
  return new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}`).toISOString();
}

export function HandsPage() {
  const [items, setItems] = useState<readonly HandSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [result, setResult] = useState<"" | "win" | "loss" | "break-even">("");
  const [roomId, setRoomId] = useState("");
  const [finishedFrom, setFinishedFrom] = useState("");
  const [finishedTo, setFinishedTo] = useState("");
  const [knownRooms, setKnownRooms] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshVersion = useNetworkStore((state) => state.refreshVersion);
  const requestEpoch = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);

  const load = useCallback(async (next?: string) => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const epoch = requestEpoch.current + 1;
    requestEpoch.current = epoch;
    setLoading(true);
    setError(null);
    try {
      const page = await listHands({
        ...(next ? { cursor: next } : {}),
        ...(finishedFrom ? { finishedFrom: localDayBoundary(finishedFrom, false) } : {}),
        ...(finishedTo ? { finishedTo: localDayBoundary(finishedTo, true) } : {}),
        ...(result ? { result } : {}),
        ...(roomId ? { roomId } : {}),
        signal: controller.signal,
      });
      if (controller.signal.aborted || requestEpoch.current !== epoch) return;
      setItems((current) => next ? [...current, ...page.items] : page.items);
      setCursor(page.nextCursor);
      setKnownRooms((current) => {
        const rooms = new Map(current);
        for (const hand of page.items) rooms.set(hand.room.roomId, hand.room.roomName);
        return rooms;
      });
    } catch (caught: unknown) {
      if (!controller.signal.aborted && requestEpoch.current === epoch) setError(readableError(caught));
    } finally {
      if (requestEpoch.current === epoch) setLoading(false);
    }
  }, [finishedFrom, finishedTo, refreshVersion, result, roomId]);

  useEffect(() => {
    void load();
    return () => activeRequest.current?.abort();
  }, [load]);
  useEffect(() => {
    let live = true;
    void (async () => {
      const rooms = new Map<string, string>();
      const seenCursors = new Set<string>();
      let nextCursor: string | null = null;
      do {
        const page = await listGames({ ...(nextCursor ? { cursor: nextCursor } : {}), limit: 100 });
        for (const game of page.items) rooms.set(game.room.roomId, game.room.roomName);
        nextCursor = page.nextCursor;
        if (nextCursor && seenCursors.has(nextCursor)) throw new Error("duplicate game-history cursor");
        if (nextCursor) seenCursors.add(nextCursor);
      } while (nextCursor);
      if (live) setKnownRooms(rooms);
    })().catch(() => undefined);
    return () => { live = false; };
  }, [refreshVersion]);
  const roomOptions = useMemo(() => [...knownRooms].sort((left, right) => left[1].localeCompare(right[1], "zh-CN")), [knownRooms]);

  return (
    <section className="space-y-5">
      <header>
        <p className="eyebrow"><Spade size={15} /> 历史牌局</p>
        <h1 className="page-title">我的手牌</h1>
      </header>

      <fieldset className="panel grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="flex items-center gap-2 px-2 text-sm text-stone-300"><Filter size={15} /> 筛选</legend>
        <label className="text-sm text-stone-300">结果
          <select className="field mt-1" onChange={(event) => setResult(event.target.value as typeof result)} value={result}>
            <option value="">全部</option><option value="win">盈利</option><option value="loss">亏损</option><option value="break-even">持平</option>
          </select>
        </label>
        <label className="text-sm text-stone-300">房间
          <select className="field mt-1" onChange={(event) => setRoomId(event.target.value)} value={roomId}>
            <option value="">全部</option>
            {roomOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label className="text-sm text-stone-300">开始日期
          <input className="field mt-1" max={finishedTo || undefined} onChange={(event) => setFinishedFrom(event.target.value)} type="date" value={finishedFrom} />
        </label>
        <label className="text-sm text-stone-300">结束日期
          <input className="field mt-1" min={finishedFrom || undefined} onChange={(event) => setFinishedTo(event.target.value)} type="date" value={finishedTo} />
        </label>
      </fieldset>

      {error && <p className="error-banner" role="alert">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((hand) => (
          <Link className="panel block" key={`${hand.handId}:${hand.runoutIndex ?? 0}`} to={`/hands/${hand.handId}${hand.runoutIndex === null ? "" : `?runoutIndex=${hand.runoutIndex}`}`}>
            <div className="flex items-start justify-between gap-2">
              <div><p className="font-medium">{hand.room.roomName} · 第 {hand.displayHandNumber} 手</p><p className="text-xs text-stone-500">{formatDateTime(hand.finishedAt)}</p></div>
              {hand.netResult === null
                ? <p className="font-semibold text-stone-400">围观</p>
                : <p className={`font-semibold ${hand.netResult >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{signedPoints(hand.netResult)}</p>}
            </div>
            <div className="mt-3 flex min-h-12 items-center gap-1" aria-label="公共牌">
              {hand.board.length > 0 ? hand.board.map((card, index) => <PlayingCard code={card} key={`${card}-${index}`} small />) : <span className="text-xs text-stone-500">未发出公共牌</span>}
            </div>
            <div className="mt-4 flex items-end justify-between gap-3">
              <div className="flex -space-x-1">{hand.ownHoleCards?.map((card) => <PlayingCard code={card} key={card} small />)}</div>
              <div className="text-right text-xs text-stone-400">
                {hand.startingStack !== null && hand.endingStack !== null && <p>{hand.startingStack.toLocaleString()} → {hand.endingStack.toLocaleString()}</p>}
                {hand.wonAnyPot !== null && <p>{hand.wonAnyPot ? hand.splitPot ? "赢得平分底池" : "赢得过底池" : "未赢得底池"}</p>}
                <p>{hand.hiddenOpponentCount} 位对手底牌未公开</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
      {!loading && items.length === 0 && <div className="panel text-center text-stone-400">没有符合条件的历史手牌</div>}
      <div className="flex justify-center">{loading ? <LoaderCircle aria-label="加载中" className="animate-spin" /> : cursor && <button className="secondary-button" onClick={() => void load(cursor)} type="button">加载更多</button>}</div>
    </section>
  );
}
