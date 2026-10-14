import {
  ROOM_CHAT_MAX_GRAPHEMES,
  RoomChatSendSchema,
  type TableRanking,
  type TableRankingPlayer,
  countRoomChatGraphemes,
  truncateRoomChatGraphemes,
} from "@paiyouju/shared";
import { LoaderCircle, MessageCircle, Send, Trophy, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { createOperationId, readableError } from "../../../api/client.js";
import { getTableRankings } from "../../../api/rooms.js";
import { tableSocket } from "../../../realtime/table-socket.js";
import { useRoomChatStore } from "../../../stores/room-chat-store.js";
import { useSwipeToClose } from "./useSwipeToClose.js";

const QUICK_EMOJI = ["👍", "😂", "😅", "😮", "👏", "🔥", "🎉", "❤️"] as const;
const EMPTY_CHAT_MESSAGES = [] as const;

function formatResult(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toLocaleString("zh-CN")}`;
}

function resultColor(value: number): string {
  return value > 0 ? "text-rose-300" : value < 0 ? "text-emerald-300" : "text-stone-300";
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours}小时` : `${hours}小时${minutes % 60}分`;
}

function RankingPlayer({ player }: { readonly player: TableRankingPlayer }) {
  return <article className={`ranking-player rounded-2xl border border-white/8 bg-black/15 p-3 ${player.seated ? "" : "ranking-player-departed"}`} data-testid={`ranking-player-${player.userId}`}>
    <div className="flex items-center gap-3">
      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-emerald-950 text-sm font-semibold text-amber-100">{player.nickname.slice(0, 1).toUpperCase()}</span>
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{player.nickname}</p><p className="text-[10px] text-stone-500">{player.seated ? `${(player.seatIndex ?? 0) + 1}号位 · 在桌` : "已离桌"}</p></div>
      <p className={`text-base font-semibold tabular-nums ${resultColor(player.netResult)}`}>{formatResult(player.netResult)}</p>
    </div>
    <dl className="mt-3 grid grid-cols-4 gap-1 text-center">
      <div><dt className="text-[9px] text-stone-500">入池率</dt><dd className="text-xs tabular-nums">{player.vpip}%</dd></div>
      <div><dt className="text-[9px] text-stone-500">胜率</dt><dd className="text-xs tabular-nums">{player.winRate}%</dd></div>
      <div><dt className="text-[9px] text-stone-500">总带入</dt><dd className="text-xs tabular-nums">{player.totalBuyIn.toLocaleString("zh-CN")}</dd></div>
      <div><dt className="text-[9px] text-stone-500">盈亏</dt><dd className={`text-xs tabular-nums ${resultColor(player.netResult)}`}>{formatResult(player.netResult)}</dd></div>
    </dl>
  </article>;
}

function ChatPanel({ connection, roomId }: {
  readonly connection: "connected" | "reconnecting" | "disconnected";
  readonly roomId: string;
}) {
  const messages = useRoomChatStore((store) => store.roomId === roomId ? store.messages : EMPTY_CHAT_MESSAGES);
  const receiveMessage = useRoomChatStore((store) => store.receiveMessage);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const count = countRoomChatGraphemes(draft);

  useEffect(() => { endRef.current?.scrollIntoView?.({ block: "nearest" }); }, [messages.length]);

  async function send(): Promise<void> {
    if (sending) return;
    const parsed = RoomChatSendSchema.safeParse({ clientMessageId: createOperationId(), content: draft, roomId });
    if (!parsed.success) { setError(draft.trim() ? `最多输入 ${ROOM_CHAT_MAX_GRAPHEMES} 个字符` : "请输入聊天内容"); return; }
    if (connection !== "connected") { setError("连接恢复后可发送"); return; }
    setSending(true);
    setError(null);
    try {
      const message = await tableSocket.command("room:chat-send", parsed.data);
      receiveMessage(message);
      setDraft("");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "聊天发送失败");
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    void send();
  }

  return <div className="chat-drawer-layout mt-4">
    <div aria-live="polite" className="table-drawer-scroll chat-message-list" data-testid="chat-message-scroll">
      {messages.length === 0 ? <div className="grid min-h-40 place-items-center text-center"><div><MessageCircle aria-hidden="true" className="mx-auto text-stone-600" size={32} /><p className="mt-3 text-sm text-stone-400">暂无消息</p></div></div> : messages.map((message) => <article className="chat-history-message" key={message.id}>
        <header><strong>{message.sender.nickname}</strong><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time></header>
        <p>{message.content}</p>
      </article>)}
      <div ref={endRef} />
    </div>
    <section aria-label="发送聊天" className="table-drawer-fixed-footer chat-composer" data-testid="chat-composer">
      <div aria-label="快捷表情" className="chat-emoji-row">{QUICK_EMOJI.map((emoji) => <button aria-label={`添加表情 ${emoji}`} key={emoji} onClick={() => setDraft((value) => truncateRoomChatGraphemes(`${value}${emoji}`))} type="button">{emoji}</button>)}</div>
      <div className="chat-compose-row"><textarea aria-label="聊天内容" onChange={(event) => setDraft(truncateRoomChatGraphemes(event.target.value))} onKeyDown={onKeyDown} placeholder="说点什么…" rows={2} value={draft} /><button aria-label="发送聊天" disabled={sending || count === 0 || connection !== "connected"} onClick={() => void send()} type="button"><Send aria-hidden="true" size={17} /></button></div>
      <div className="chat-compose-meta"><span className={error ? "text-rose-300" : "text-stone-500"} role={error ? "alert" : undefined}>{error ?? (connection === "connected" ? "" : "连接恢复后可发送")}</span><span>{count}/{ROOM_CHAT_MAX_GRAPHEMES}</span></div>
    </section>
  </div>;
}

export function ChatDrawer({ connection, onClose, open, roomId, stateVersion }: {
  readonly connection: "connected" | "reconnecting" | "disconnected";
  readonly onClose: () => void;
  readonly open: boolean;
  readonly roomId: string;
  readonly stateVersion: number;
}) {
  const [tab, setTab] = useState<"ranking" | "chat">("ranking");
  const [ranking, setRanking] = useState<TableRanking | null>(null);
  const [showDeparted, setShowDeparted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const swipe = useSwipeToClose("left", onClose);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setError(null);
    void getTableRankings(roomId, controller.signal).then(setRanking).catch((caught: unknown) => {
      if (!controller.signal.aborted) setError(readableError(caught));
    });
    return () => controller.abort();
  }, [open, roomId, stateVersion]);

  const visiblePlayers = useMemo(() => ranking?.players.filter((player) => showDeparted || player.seated) ?? [], [ranking, showDeparted]);
  if (!open) return null;
  return <><button aria-label="关闭排名和聊天并返回牌桌" className="table-drawer-backdrop" onClick={onClose} type="button" /><aside aria-label="排名和聊天抽屉" className="table-drawer table-drawer-left" {...swipe}>
    <header className="flex items-center justify-between"><div className="flex items-center gap-2"><Trophy size={18} /><h2 className="font-semibold">牌桌信息</h2></div><button aria-label="关闭排名和聊天" className="table-icon-button" onClick={onClose} type="button"><X /></button></header>
    <nav aria-label="牌桌信息分类" className="mt-4 grid grid-cols-2 rounded-xl bg-black/20 p-1">
      <button aria-selected={tab === "ranking"} className={`rounded-lg px-3 py-2 text-xs ${tab === "ranking" ? "bg-white/10 text-amber-100" : "text-stone-500"}`} onClick={() => setTab("ranking")} role="tab" type="button"><Trophy className="mr-1 inline" size={14} />排名</button>
      <button aria-selected={tab === "chat"} className={`rounded-lg px-3 py-2 text-xs ${tab === "chat" ? "bg-white/10 text-amber-100" : "text-stone-500"}`} onClick={() => setTab("chat")} role="tab" type="button"><MessageCircle className="mr-1 inline" size={14} />聊天</button>
    </nav>
    {tab === "chat" ? <ChatPanel connection={connection} roomId={roomId} /> : <>
      <div className="table-drawer-scroll mt-4" data-testid="ranking-player-scroll">
      <div className="flex items-center justify-between"><p className="text-xs text-stone-400">按盈亏排序</p><button aria-label={showDeparted ? "隐藏离桌玩家" : "显示离桌玩家"} aria-pressed={showDeparted} className="rounded-full border border-white/10 px-3 py-1 text-[10px] text-stone-300" onClick={() => setShowDeparted((value) => !value)} type="button">{showDeparted ? "隐藏离桌" : `显示离桌${ranking?.summary.departedPlayers ? ` ${ranking.summary.departedPlayers}` : ""}`}</button></div>
      {error && <p className="mt-4 text-sm text-rose-300" role="alert">{error}</p>}
      {!ranking && !error ? <div className="grid min-h-40 place-items-center"><LoaderCircle className="animate-spin" /></div> : visiblePlayers.length === 0 ? <p className="py-10 text-center text-sm text-stone-500">暂无牌局数据</p> : <div className="mt-3 space-y-2">{visiblePlayers.map((player) => <RankingPlayer key={player.userId} player={player} />)}</div>}
      </div>
      {ranking && <section aria-label="牌桌公共信息" className="table-drawer-fixed-footer mt-3 rounded-2xl border border-white/8 bg-black/20 p-3"><h3 className="text-xs text-stone-400">牌桌公共信息</h3><dl className="mt-3 grid grid-cols-3 gap-y-3 text-center"><div><dt className="text-[9px] text-stone-500">总带入</dt><dd className="text-xs">{ranking.summary.totalBuyIn.toLocaleString("zh-CN")}</dd></div><div><dt className="text-[9px] text-stone-500">总底池</dt><dd className="text-xs">{ranking.summary.totalPot.toLocaleString("zh-CN")}</dd></div><div><dt className="text-[9px] text-stone-500">手数</dt><dd className="text-xs">{ranking.summary.handsPlayed}</dd></div><div><dt className="text-[9px] text-stone-500">平均底池</dt><dd className="text-xs">{ranking.summary.averagePot.toLocaleString("zh-CN")}</dd></div><div><dt className="text-[9px] text-stone-500">已运行</dt><dd className="text-xs">{formatElapsed(ranking.summary.elapsedSeconds)}</dd></div><div><dt className="text-[9px] text-stone-500">在桌</dt><dd className="text-xs">{ranking.summary.activePlayers}</dd></div></dl></section>}
    </>}
  </aside></>;
}
