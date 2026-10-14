import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useRoomStore } from "../stores/room-store.js";
import { useNetworkStore } from "../stores/network-store.js";

export function JoinRoomPage() {
  const navigate = useNavigate();
  const { error, joinRoom, loading } = useRoomStore();
  const online = useNetworkStore((state) => state.online);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    try { const password = String(data.get("password") ?? ""); const room = await joinRoom({ ...(password ? { password } : {}), roomCode: String(data.get("roomCode")) }); navigate(`/tables/${room.id}`); } catch { /* store renders error */ }
  }
  return <section className="mx-auto max-w-md"><Link className="text-sm text-stone-400 hover:text-white" to="/">← 返回大厅</Link><h1 className="mt-5 text-3xl font-semibold">加入私人房间</h1><form className="panel mt-7 space-y-5" onSubmit={(event) => { void submit(event); }}><label>房间码<input autoComplete="off" className="field mt-2 text-center text-2xl tracking-[.35em]" inputMode="numeric" maxLength={6} minLength={6} name="roomCode" pattern="\d{6}" required /></label><label>房间密码（如有）<input className="field mt-2" maxLength={64} name="password" type="password" /></label>{error && <p className="error-banner" role="alert">{error}</p>}<button className="primary-button w-full" disabled={loading || !online} type="submit">{loading ? "正在加入…" : online ? "加入房间" : "离线时不可加入"}</button></form></section>;
}
