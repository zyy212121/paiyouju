import type { GameSessionDetail } from "@paiyouju/shared";
import { ArrowLeft, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { readableError } from "../api/client.js";
import { getGame } from "../api/games.js";
import { PlayingCard } from "../components/PlayingCard.js";
import { formatDateTime, signedPoints } from "../features/history/history-format.js";
import { useNetworkStore } from "../stores/network-store.js";

export function GameSessionPage() {
  const { gameSessionId = "" } = useParams();
  const [game, setGame] = useState<GameSessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshVersion = useNetworkStore((state) => state.refreshVersion);
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    setGame(null);
    setError(null);
    void getGame(gameSessionId, controller.signal)
      .then((value) => {
        if (live && value.gameSessionId === gameSessionId) setGame(value);
      })
      .catch((caught: unknown) => {
        if (live && !controller.signal.aborted) setError(readableError(caught));
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [gameSessionId, refreshVersion]);
  if (error) return <p className="error-banner" role="alert">{error}</p>;
  if (!game) return <div className="grid min-h-64 place-items-center" role="status"><LoaderCircle aria-hidden="true" className="animate-spin" /><span className="sr-only">正在加载对局详情</span></div>;
  const result = game.netResult ?? game.provisionalNetResult ?? 0;
  return <section className="space-y-5"><Link className="inline-flex items-center gap-2 text-sm text-stone-300" to="/games"><ArrowLeft size={16} /> 返回对局</Link><header className="panel flex flex-wrap justify-between gap-4"><div><p className="eyebrow">{game.status === "ACTIVE" ? "活动对局" : "已结束对局"}</p><h1 className="text-2xl font-semibold">{game.room.roomName}</h1><p className="mt-1 text-sm text-stone-400">{formatDateTime(game.startedAt)} — {formatDateTime(game.endedAt)}</p></div><div className="text-right"><p className="text-xs text-stone-400">{game.status === "ACTIVE" ? "当前结果（对局中）" : "最终结果"}</p><p className={`text-2xl font-bold ${result >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{signedPoints(result)}</p><p className="text-xs text-stone-500">累计领取 {game.totalBuyIn.toLocaleString()} · {game.status === "ACTIVE" ? `桌上 ${game.currentStack?.toLocaleString() ?? "—"}` : `离桌点数 ${game.totalCashOut.toLocaleString()}`}</p></div></header><div className="space-y-3"><h2 className="section-title">参与的手牌</h2>{game.hands.map((hand) => <Link className="panel history-row" key={hand.handId} to={`/hands/${hand.handId}`}><div><p className="font-medium">第 {hand.handNumber} 手 · {hand.finishReason === "SHOWDOWN" ? "摊牌" : "弃牌结束"}</p><div className="mt-2 flex gap-1">{hand.ownHoleCards?.map((card) => <PlayingCard code={card} key={card} small />)}</div></div><div className="text-right">{hand.netResult !== null && <p className={hand.netResult >= 0 ? "text-emerald-300" : "text-rose-300"}>{signedPoints(hand.netResult)}</p>}<p className="text-xs text-stone-500">{formatDateTime(hand.finishedAt)}</p></div></Link>)}</div></section>;
}
