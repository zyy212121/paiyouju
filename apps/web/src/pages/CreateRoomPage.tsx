import {
  BOMB_POT_BLIND_MULTIPLIER_MAX,
  BOMB_POT_BLIND_MULTIPLIER_MIN,
  BOMB_POT_INTERVAL_MINUTES_OPTIONS,
  DEFAULT_BOMB_POT_BLIND_MULTIPLIER,
  DEFAULT_BOMB_POT_INTERVAL_MINUTES,
  squidStakeOptions,
} from "@paiyouju/shared";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useNetworkStore } from "../stores/network-store.js";
import { useRoomStore } from "../stores/room-store.js";

export function CreateRoomPage() {
  const navigate = useNavigate();
  const online = useNetworkStore((state) => state.online);
  const { createRoom, error, loading } = useRoomStore();
  const [actionTimeSeconds, setActionTimeSeconds] = useState(30);
  const [bigBlind, setBigBlind] = useState(20);
  const [bigBlindPreset, setBigBlindPreset] = useState(20);
  const [bombPotBlindMultiplier, setBombPotBlindMultiplier] = useState<number>(DEFAULT_BOMB_POT_BLIND_MULTIPLIER);
  const [bombPotEnabled, setBombPotEnabled] = useState(false);
  const [bombPotIntervalMinutes, setBombPotIntervalMinutes] = useState<number>(DEFAULT_BOMB_POT_INTERVAL_MINUTES);
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [initialBuyIn, setInitialBuyIn] = useState(2_000);
  const [runItTwiceEnabled, setRunItTwiceEnabled] = useState(false);
  const [squidEnabled, setSquidEnabled] = useState(false);
  const [squidTier, setSquidTier] = useState(1);
  const [shortDeckEnabled, setShortDeckEnabled] = useState(false);
  const [shortDeckMinimumStack, setShortDeckMinimumStack] = useState(500);
  const [shortDeckMaximumStack, setShortDeckMaximumStack] = useState(2_000);
  const squidStakes = squidStakeOptions(initialBuyIn);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    const room = await createRoom({
      actionTimeSeconds,
      bigBlind,
      ...(bombPotEnabled ? { bombPotBlindMultiplier, bombPotIntervalMinutes } : {}),
      durationMinutes,
      ...(shortDeckEnabled
        ? { maximumBuyIn: shortDeckMaximumStack, minimumBuyIn: shortDeckMinimumStack }
        : { initialBuyIn }),
      maxSeats: Number(data.get("maxSeats")),
      name: String(data.get("name")),
      ...(password ? { password } : {}),
      runItTwiceEnabled: squidEnabled || shortDeckEnabled || bombPotEnabled ? false : runItTwiceEnabled,
      specialMode: bombPotEnabled ? "BOMB_POT" : shortDeckEnabled ? "SHORT_DECK" : squidEnabled ? "SQUID" : "NORMAL",
      ...(squidEnabled ? { squidStake: squidStakes[squidTier - 1] } : {}),
    });
    navigate(`/rooms/${room.id}`);
  }

  return (
    <section className="mx-auto max-w-2xl">
      <Link className="text-sm text-stone-400 hover:text-white" to="/">← 返回大厅</Link>
      <h1 className="mt-5 text-3xl font-semibold">创建私人房间</h1>
      <form className="panel mt-7 grid gap-5 sm:grid-cols-2" onSubmit={(event) => { void submit(event); }}>
        <label className="sm:col-span-2">房间名称<input className="field mt-2" defaultValue="周末牌局" maxLength={40} name="name" required /></label>
        <label>最大座位<select className="field mt-2" defaultValue="6" name="maxSeats">{Array.from({ length: 8 }, (_, index) => index + 2).map((count) => <option key={count} value={count}>{count} 人</option>)}</select></label>
        <label className="grid gap-2">行动时间 <output className="text-emerald-200">{actionTimeSeconds} 秒</output><input aria-label="行动时间" max="45" min="10" name="actionTimeSeconds" onChange={(event) => setActionTimeSeconds(Number(event.target.value))} step="5" type="range" value={actionTimeSeconds} /></label>
        <label className="sm:col-span-2 grid gap-2">房间时长 <output className="text-emerald-200">{durationMinutes} 分钟</output><input aria-label="房间时长" max="180" min="30" name="durationMinutes" onChange={(event) => setDurationMinutes(Number(event.target.value))} step="30" type="range" value={durationMinutes} /></label>
        <section aria-label="盲注设置" className="sm:col-span-2 grid gap-3 rounded-xl border border-emerald-300/20 bg-emerald-950/15 p-4 sm:grid-cols-2">
          <label className="grid gap-2">大盲快捷档位 <output className="text-emerald-200">{bigBlind} 点</output><input aria-label="大盲快捷档位" max="50" min="10" onChange={(event) => { const value = Number(event.target.value); setBigBlindPreset(value); setBigBlind(value); }} step="10" type="range" value={bigBlindPreset} /></label>
          <label>大盲手动输入<input aria-label="大盲手动输入" className="field mt-2" max={(shortDeckEnabled ? shortDeckMinimumStack : initialBuyIn) - 1} min="2" name="bigBlind" onChange={(event) => setBigBlind(Math.max(2, Math.trunc(Number(event.target.value))))} required step="1" type="number" value={bigBlind} /></label>
          <p className="text-sm text-stone-400 sm:col-span-2">小盲自动 {Math.ceil(bigBlind / 2)} 点</p>
        </section>
        {!shortDeckEnabled && <label className="sm:col-span-2">初始带入<input aria-label="初始带入" className="field mt-2" min={bigBlind + 1} name="initialBuyIn" onChange={(event) => setInitialBuyIn(Math.max(bigBlind + 1, Number(event.target.value)))} required type="number" value={initialBuyIn} /></label>}
        <label className="sm:col-span-2">房间密码（可选）<input className="field mt-2" maxLength={64} minLength={4} name="password" type="password" /></label>
        <fieldset className="sm:col-span-2 grid gap-3 sm:grid-cols-2">
          <legend className="sr-only">房间玩法</legend>
          <label className={`flex items-center gap-3 rounded-xl border border-cyan-300/20 bg-cyan-950/20 p-3 ${squidEnabled || shortDeckEnabled || bombPotEnabled ? "opacity-45" : ""}`}><input aria-label="All-in 后发两次" checked={runItTwiceEnabled} disabled={squidEnabled || shortDeckEnabled || bombPotEnabled} onChange={(event) => setRunItTwiceEnabled(event.target.checked)} type="checkbox" /><span className="block">All-in 后发两次</span></label>
          <label className="flex items-center gap-3 rounded-xl border border-emerald-300/20 bg-emerald-950/20 p-3"><input aria-label="鱿鱼模式" checked={squidEnabled} onChange={(event) => { const enabled = event.target.checked; setSquidEnabled(enabled); if (enabled) { setBombPotEnabled(false); setRunItTwiceEnabled(false); setShortDeckEnabled(false); } }} type="checkbox" /><span className="block">鱿鱼模式</span></label>
          <label className="flex items-center gap-3 rounded-xl border border-amber-300/20 bg-amber-950/20 p-3"><input aria-label="短牌模式" checked={shortDeckEnabled} onChange={(event) => { const enabled = event.target.checked; setShortDeckEnabled(enabled); if (enabled) { setBombPotEnabled(false); setRunItTwiceEnabled(false); setSquidEnabled(false); } }} type="checkbox" /><span className="block">短牌模式</span></label>
          <label className="flex items-center gap-3 rounded-xl border border-rose-300/20 bg-rose-950/20 p-3"><input aria-label="暴击模式" checked={bombPotEnabled} onChange={(event) => { const enabled = event.target.checked; setBombPotEnabled(enabled); if (enabled) { setRunItTwiceEnabled(false); setShortDeckEnabled(false); setSquidEnabled(false); } }} type="checkbox" /><span className="block">暴击模式</span></label>
        </fieldset>
        {squidEnabled && (
          <label className="sm:col-span-2 grid gap-2 rounded-xl border border-amber-300/20 bg-amber-950/15 p-4">
            鱿鱼每人支付 <output className="text-amber-200">{squidStakes[squidTier - 1]} 点 / 人</output>
            <input aria-label="鱿鱼每人支付" max="5" min="1" onChange={(event) => setSquidTier(Number(event.target.value))} step="1" type="range" value={squidTier} />
          </label>
        )}
        {shortDeckEnabled && (
          <section aria-label="短牌后手范围" className="sm:col-span-2 grid gap-4 rounded-xl border border-amber-300/20 bg-amber-950/15 p-4">
            <label className="grid gap-2">后手下限 <output className="text-amber-200">{shortDeckMinimumStack.toLocaleString("zh-CN")} 点</output><input aria-label="短牌后手下限" max="5000" min="100" onChange={(event) => setShortDeckMinimumStack(Math.min(Number(event.target.value), shortDeckMaximumStack))} step="100" type="range" value={shortDeckMinimumStack} /></label>
            <label className="grid gap-2">后手上限 <output className="text-amber-200">{shortDeckMaximumStack.toLocaleString("zh-CN")} 点</output><input aria-label="短牌后手上限" max="20000" min="500" onChange={(event) => setShortDeckMaximumStack(Math.max(Number(event.target.value), shortDeckMinimumStack))} step="100" type="range" value={shortDeckMaximumStack} /></label>
          </section>
        )}
        {bombPotEnabled && (
          <section aria-label="暴击参数" className="sm:col-span-2 grid gap-4 rounded-xl border border-rose-300/20 bg-rose-950/15 p-4">
            <label className="grid gap-2">暴击频率 <output className="text-rose-200">每 {bombPotIntervalMinutes} 分钟</output><input aria-label="暴击频率" aria-valuetext={`${bombPotIntervalMinutes} 分钟`} max={BOMB_POT_INTERVAL_MINUTES_OPTIONS.length - 1} min="0" onChange={(event) => setBombPotIntervalMinutes(BOMB_POT_INTERVAL_MINUTES_OPTIONS[Number(event.target.value)] ?? DEFAULT_BOMB_POT_INTERVAL_MINUTES)} step="1" type="range" value={BOMB_POT_INTERVAL_MINUTES_OPTIONS.findIndex((value) => value === bombPotIntervalMinutes)} /></label>
            <label className="grid gap-2">暴击盲注 <output className="text-rose-200">{bombPotBlindMultiplier} BB（{(bombPotBlindMultiplier * bigBlind).toLocaleString("zh-CN")} 点）</output><input aria-label="暴击盲注" max={BOMB_POT_BLIND_MULTIPLIER_MAX} min={BOMB_POT_BLIND_MULTIPLIER_MIN} onChange={(event) => setBombPotBlindMultiplier(Number(event.target.value))} step="1" type="range" value={bombPotBlindMultiplier} /></label>
          </section>
        )}
        {error && <p className="error-banner sm:col-span-2" role="alert">{error}</p>}
        <button className="primary-button sm:col-span-2" disabled={loading || !online} type="submit">{loading ? "正在创建…" : online ? "创建房间" : "离线时不可创建"}</button>
      </form>
    </section>
  );
}
