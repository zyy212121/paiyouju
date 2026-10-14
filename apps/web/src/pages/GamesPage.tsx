import type { GameSessionSummary } from "@paiyouju/shared";
import { History, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { readableError } from "../api/client.js";
import { listGames } from "../api/games.js";
import { formatDateTime, signedPoints } from "../features/history/history-format.js";
import { useNetworkStore } from "../stores/network-store.js";

export function GamesPage() {
  const [items, setItems] = useState<readonly GameSessionSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"" | "ACTIVE" | "CLOSED">("");
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
      const page = await listGames({ ...(next ? { cursor: next } : {}), signal: controller.signal, ...(status ? { status } : {}) });
      if (controller.signal.aborted || requestEpoch.current !== epoch) return;
      setItems((current) => next ? [...current, ...page.items] : page.items);
      setCursor(page.nextCursor);
    } catch (caught: unknown) {
      if (!controller.signal.aborted && requestEpoch.current === epoch) setError(readableError(caught));
    } finally {
      if (requestEpoch.current === epoch) setLoading(false);
    }
  }, [refreshVersion, status]);

  useEffect(() => {
    void load();
    return () => activeRequest.current?.abort();
  }, [load]);
  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="eyebrow"><History size={15} /> 对局记录</p><h1 className="page-title">我的对局</h1><p className="page-subtitle">一次坐下、领取房间点数、游戏到离桌构成一局。</p></div>
        <label className="text-sm text-stone-300">状态
          <select className="field mt-1" onChange={(event) => setStatus(event.target.value as typeof status)} value={status}>
            <option value="">全部</option><option value="ACTIVE">进行中</option><option value="CLOSED">已结束</option>
          </select>
        </label>
      </header>
      {error && <p className="error-banner" role="alert">{error}</p>}
      <div className="grid gap-3">
        {items.map((game) => {
          const result = game.netResult ?? game.provisionalNetResult ?? 0;
          return (
            <Link className="panel history-row flex-wrap" key={game.gameSessionId} to={`/games/${game.gameSessionId}`}>
              <div>
                <p className="font-medium">{game.room.roomName} <span className="text-xs text-stone-500">#{game.room.roomCode}</span></p>
                <p className="mt-1 text-xs text-stone-400">{formatDateTime(game.startedAt)} — {formatDateTime(game.endedAt)}</p>
                <p className="mt-1 text-xs text-stone-500">座位 {game.seatIndex + 1} · {game.handsPlayed} 手 · 累计领取 {game.totalBuyIn.toLocaleString()}</p>
              </div>
              <div className="text-right">
                <span className="status-chip">{game.status === "ACTIVE" ? "进行中" : "已结束"}</span>
                <p className={`mt-2 font-semibold ${result >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{game.status === "ACTIVE" ? "当前 " : "最终 "}{signedPoints(result)}</p>
                <p className="text-xs text-stone-500">{game.status === "ACTIVE" ? `桌上 ${game.currentStack?.toLocaleString() ?? "—"}` : `离桌点数 ${game.totalCashOut.toLocaleString()}`}</p>
              </div>
            </Link>
          );
        })}
      </div>
      {!loading && items.length === 0 && <div className="panel text-center text-stone-400">还没有对局记录</div>}
      <div className="flex justify-center">{loading ? <LoaderCircle aria-label="加载中" className="animate-spin text-amber-200" /> : cursor && <button className="secondary-button" onClick={() => void load(cursor)} type="button">加载更多</button>}</div>
    </section>
  );
}
