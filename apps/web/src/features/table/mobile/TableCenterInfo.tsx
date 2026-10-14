import type { TableStateProjection } from "@paiyouju/shared";
import { Copy, Play } from "lucide-react";
import { useEffect, useState } from "react";

function formatRemaining(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor(totalSeconds % 3_600 / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

export function TableRemainingTime({ expiresAt, started }: { readonly expiresAt: string; readonly started: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  if (!started) return <span className="font-mono" data-testid="table-remaining">未开始</span>;
  const remaining = Date.parse(expiresAt) - now;
  return <time className="font-mono" data-testid="table-remaining" dateTime={expiresAt}>{formatRemaining(remaining)}</time>;
}

export function BombPotCountdown({ nextAt, started }: { readonly nextAt: string | null; readonly started: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  if (!started || nextAt === null) return <span data-testid="bomb-pot-countdown">暴击倒计时 等待开桌</span>;
  const remainingSeconds = Math.max(0, Math.ceil((Date.parse(nextAt) - now) / 1_000));
  if (remainingSeconds === 0) return <span data-testid="bomb-pot-countdown">下一手暴击</span>;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return <time data-testid="bomb-pot-countdown" dateTime={nextAt}>暴击倒计时 {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}</time>;
}

export function TableCenterInfo({ onCopyInvite, onStart, state, working }: {
  readonly onCopyInvite: () => void;
  readonly onStart: () => void;
  readonly state: TableStateProjection;
  readonly working: boolean;
}) {
  const eligiblePlayers = state.seats.filter((seat) => seat.connected && seat.stack > 0 && seat.playStatus === "ACTIVE").length;
  const waiting = state.hand === null && state.runtimeStatus !== "POST_HAND_REVIEW";
  return (
    <section className="table-center-info" data-testid="table-center-info">
      <p className="text-[10px] tracking-[.12em] text-emerald-100/45">房间剩余 <TableRemainingTime expiresAt={state.room.expiresAt} started={state.room.tableStartedAt !== null} /></p>
      <p className="mt-1 text-[10px] text-emerald-100/50">盲注 {state.room.smallBlind}/{state.room.bigBlind} · 房间 {state.room.roomCode}</p>
      {state.room.specialMode === "BOMB_POT" && <p className="mt-1 text-[10px] font-semibold tracking-[.08em] text-rose-200"><BombPotCountdown nextAt={state.room.bombPotNextAt ?? null} started={state.room.tableStartedAt !== null} /></p>}
      {waiting && eligiblePlayers < 2 && <button className="center-primary-control" onClick={onCopyInvite} type="button"><Copy size={16} />邀请好友</button>}
      {waiting && state.canOwnerStart && <button className="center-primary-control" disabled={working} onClick={onStart} type="button"><Play size={17} />{working ? "正在开始…" : "开始游戏"}</button>}
      {waiting && eligiblePlayers >= 2 && !state.canOwnerStart && state.tableRunState !== "RUNNING" && <p className="mt-3 rounded-full bg-black/20 px-4 py-2 text-xs text-stone-300">等待房主开始</p>}
      {state.tableRunState === "STOPPED_INSUFFICIENT_PLAYERS" && <p className="mt-3 rounded-xl border border-amber-200/20 bg-black/25 px-3 py-2 text-xs text-amber-100">有效玩家不足，牌局停发</p>}
      {state.room.nextHandPaused && <p className="mt-3 text-xs text-amber-200">下一手已由房主暂停</p>}
    </section>
  );
}
