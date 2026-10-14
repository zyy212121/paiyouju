import { Archive, ChevronDown, Diamond, History } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { useAuthStore } from "../stores/auth-store.js";
import { useRoomStore } from "../stores/room-store.js";
import { createOperationId, HttpApiError } from "../api/client.js";

type ArchiveConfirmation = { readonly kind: "all" } | { readonly kind: "room"; readonly roomId: string };

export function LobbyPage() {
  const user = useAuthStore((state) => state.user)!;
  const { archiveAllClosedRooms, archiveRoom, closedRooms, closedRoomsNextCursor, error, loading, rooms, loadClosedRooms, loadLobby } = useRoomStore();
  const [archiving, setArchiving] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ArchiveConfirmation | null>(null);
  const archiveOperations = useRef(new Map<string, string>());
  useEffect(() => { void Promise.all([loadLobby(), loadClosedRooms()]); }, [loadClosedRooms, loadLobby]);
  async function archive(roomId: string) {
    const operationId = archiveOperations.current.get(roomId) ?? createOperationId();
    archiveOperations.current.set(roomId, operationId);
    setArchiving(roomId);
    try { await archiveRoom(roomId, operationId); archiveOperations.current.delete(roomId); }
    catch (caught: unknown) {
      const uncertain = caught instanceof HttpApiError && (caught.code === "NETWORK_ERROR" || caught.code === "REQUEST_TIMEOUT");
      if (!uncertain) archiveOperations.current.delete(roomId);
    } finally { setArchiving(null); }
  }
  async function confirmArchive() {
    if (!confirmation) return;
    const target = confirmation;
    setConfirmation(null);
    if (target.kind === "room") {
      await archive(target.roomId);
      return;
    }
    setArchiving("all");
    try { await archiveAllClosedRooms(); }
    catch {
      // The store exposes the server error in the existing lobby alert. Keep the
      // click handler settled so a failed bulk archive cannot become an unhandled
      // promise rejection in the browser.
    }
    finally { setArchiving(null); }
  }
  const hasOwnedClosedRooms = closedRooms.some((room) => room.memberRole === "OWNER");
  return (
    <div className="space-y-7">
      <section className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <div><p className="text-sm text-teal-200">晚上好，{user.nickname}</p><h1 className="mt-2 text-3xl font-semibold sm:text-4xl">你的私人牌局</h1></div>
        <div className="flex gap-2"><Link className="secondary-button" to="/rooms/join">加入房间</Link><Link className="primary-button" to="/rooms/create">创建房间</Link></div>
      </section>
      <section className="grid gap-4 sm:grid-cols-3">
        <article className="panel"><p className="flex items-center gap-1 text-sm text-stone-400"><Diamond size={14} />当前钻石</p><p data-testid="wallet-balance" className="mt-2 text-3xl font-semibold text-sky-200">{user.walletBalance.toLocaleString()}</p></article>
        <article className="panel"><p className="text-sm text-stone-400">已加入房间</p><p className="mt-2 text-3xl font-semibold">{rooms.length}</p></article>
        <article className="panel"><p className="text-sm text-stone-400">游戏类型</p><p className="mt-2 font-medium">No-Limit Texas Hold’em</p><p className="mt-1 text-xs text-stone-500">2–9 人 · 无抽水</p></article>
      </section>
      {error && <p role="alert" className="error-banner">{error}</p>}
      <section><h2 className="mb-4 text-xl font-medium">进行中的房间</h2>{loading && rooms.length === 0 ? <p className="text-stone-400">正在加载…</p> : rooms.length === 0 ? <div className="panel border-dashed py-12 text-center"><p className="text-stone-300">还没有进行中的房间</p><p className="mt-2 text-sm text-stone-500">创建一桌，或输入朋友给你的 6 位房间码。</p></div> : <div className="grid gap-3 lg:grid-cols-2">{rooms.map((room) => <Link className="panel group flex items-center justify-between gap-4 transition hover:-translate-y-0.5 hover:border-teal-300/30" key={room.id} to={`/tables/${room.id}`}><div><div className="flex items-center gap-2"><h3 className="font-medium">{room.name}</h3><span className={`status-chip ${room.status === "OPEN" ? "text-emerald-300" : "text-amber-300"}`}>{room.status}</span></div><p className="mt-2 text-sm text-stone-400">#{room.roomCode} · {room.maxSeats} 人 · {room.smallBlind}/{room.bigBlind}</p></div><span className="text-stone-500 transition group-hover:translate-x-1">→</span></Link>)}</div>}</section>
      <section data-testid="closed-room-list"><div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-xl font-medium">已结束房间</h2><div className="flex items-center gap-2">{hasOwnedClosedRooms && <button aria-label="一键清空已结束房间" className="secondary-button gap-2" disabled={archiving !== null} onClick={() => setConfirmation({ kind: "all" })} type="button"><Archive size={16} />{archiving === "all" ? "清空中…" : "一键清空"}</button>}<History className="text-stone-600" /></div></div>{closedRooms.length === 0 ? <div className="panel border-dashed py-8 text-center text-sm text-stone-500">暂无未归档的已结束房间</div> : <div className="space-y-3">{closedRooms.map((room) => <article className="panel flex flex-wrap items-center justify-between gap-3 !p-4" key={room.id}><Link className="min-w-0 flex-1" to={`/tables/${room.id}`}><p className="truncate font-medium">{room.name}</p><p className="mt-1 text-xs text-stone-500">#{room.roomCode} · {room.closedAt ? new Date(room.closedAt).toLocaleString("zh-CN") : "已结束"}</p></Link>{room.memberRole === "OWNER" && <button className="secondary-button gap-2" disabled={archiving !== null} onClick={() => setConfirmation({ kind: "room", roomId: room.id })} type="button"><Archive size={16} />{archiving === room.id ? "归档中…" : "从列表移除"}</button>}</article>)}{closedRoomsNextCursor && <button className="secondary-button mx-auto flex gap-2" onClick={() => void loadClosedRooms(true)} type="button"><ChevronDown size={16} />加载更多</button>}</div>}</section>
      {confirmation && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmation(null); }}><section aria-labelledby="archive-confirmation-title" aria-modal="true" className="modal-card" role="dialog"><h2 className="text-lg font-semibold" id="archive-confirmation-title">{confirmation.kind === "all" ? "确认清空已结束房间" : "确认移除已结束房间"}</h2><div className="mt-5 grid grid-cols-2 gap-2"><button className="secondary-button" onClick={() => setConfirmation(null)} type="button">取消</button><button className="primary-button" onClick={() => void confirmArchive()} type="button">{confirmation.kind === "all" ? "确认清空" : "确认移除"}</button></div></section></div>}
    </div>
  );
}
