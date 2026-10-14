import type { ProjectedSeat, TableStateProjection } from "@paiyouju/shared";
import { Bot, CircleHelp, Diamond, DoorOpen, LogOut, Pause, Play, ShieldCheck, UserRoundX, Volume2, X } from "lucide-react";
import { useState } from "react";

import type { TableVoiceGender } from "./useTableSound.js";

function MenuButton({ children, danger = false, disabled = false, onClick, pressed }: {
  readonly children: React.ReactNode;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly onClick?: () => void;
  readonly pressed?: boolean;
}) {
  return <button {...(pressed === undefined ? {} : { "aria-pressed": pressed })} className={`table-menu-item ${danger ? "text-rose-200" : ""} ${pressed ? "is-pressed" : ""}`} disabled={disabled} onClick={onClick} type="button">{children}</button>;
}

export function TableMenuPopover({ mySeat, onClose, onExit, onOwnerAction, onReserveAway, onReturn, onSoundVolume, onStand, onTrusteeship, onVoiceGenderChange, open, soundVolume, state, voiceGender, working }: {
  readonly mySeat: ProjectedSeat | null;
  readonly onClose: () => void;
  readonly onExit: () => void;
  readonly onOwnerAction: (action: "pause" | "resume" | "close") => void;
  readonly onReserveAway: () => void;
  readonly onReturn: () => void;
  readonly onSoundVolume: (volume: number) => void;
  readonly onStand: () => void;
  readonly onTrusteeship: () => void;
  readonly onVoiceGenderChange: (gender: TableVoiceGender) => void;
  readonly open: boolean;
  readonly soundVolume: number;
  readonly state: TableStateProjection;
  readonly voiceGender: TableVoiceGender;
  readonly working: boolean;
}) {
  const [info, setInfo] = useState<"fees" | "rules" | "sound" | null>(null);
  if (!open) return null;
  return (
    <div className="table-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-label="牌桌菜单" className="table-menu-sheet">
        <header className="flex items-center justify-between"><div><p className="text-xs text-stone-500">牌桌菜单</p><h2 className="font-semibold">{state.room.name}</h2></div><button aria-label="关闭菜单" className="table-icon-button" onClick={onClose} type="button"><X /></button></header>
        <div className="mt-4 grid gap-1">
          {mySeat && <MenuButton disabled={working} onClick={onTrusteeship} pressed={state.trusteeshipEnabled}><Bot />{state.trusteeshipEnabled ? "取消托管" : "托管 · 让或弃"}</MenuButton>}
          {mySeat && ["RESERVED_AWAY", "SIT_OUT"].includes(mySeat.playStatus) ? <MenuButton disabled={working} onClick={onReturn}><DoorOpen />回到牌桌</MenuButton> : mySeat?.playStatus === "ACTIVE" && <MenuButton disabled={working || state.room.status !== "OPEN" || state.room.specialMode === "SQUID"} onClick={onReserveAway}><ShieldCheck />{state.room.specialMode === "SQUID" ? "鱿鱼模式不可保位离桌" : "保位离桌 · 60 秒"}</MenuButton>}
          {mySeat && <MenuButton disabled={working} onClick={onStand}><UserRoundX />站起围观</MenuButton>}
          <MenuButton disabled={state.room.specialMode === "NORMAL" && !state.room.runItTwiceEnabled} onClick={() => setInfo(info === "rules" ? null : "rules")}><CircleHelp />规则说明</MenuButton>
          <MenuButton onClick={() => setInfo(info === "fees" ? null : "fees")}><Diamond />钻石说明</MenuButton>
          <MenuButton onClick={() => setInfo(info === "sound" ? null : "sound")}><Volume2 />声音</MenuButton>
          {state.recipient.isOwner && state.room.status === "OPEN" && <><div className="my-2 border-t border-white/10" />{state.room.nextHandPaused ? <MenuButton disabled={working} onClick={() => onOwnerAction("resume")}><Play />房主：恢复下一手</MenuButton> : <MenuButton disabled={working} onClick={() => onOwnerAction("pause")}><Pause />房主：暂停下一手</MenuButton>}<MenuButton danger disabled={working} onClick={() => onOwnerAction("close")}><X />房主：安全关闭房间</MenuButton></>}
          <div className="my-2 border-t border-white/10" />
          <MenuButton danger disabled={working} onClick={onExit}><LogOut />退出牌局</MenuButton>
        </div>
        {info === "rules" && state.room.specialMode === "SQUID" && <div className="mt-3 space-y-2 rounded-xl bg-black/25 p-3 text-xs leading-5 text-stone-300"><p>唯一赢得主池的玩家获得鱿鱼标记；平分主池与边池不产生标记。</p><p>本手结束后若只剩一名本轮玩家没有标记，该玩家向其余本轮玩家每人支付 {state.room.squidStake?.toLocaleString() ?? "—"} 点，随后开始新一轮。</p><p>每轮结算后有 10 秒无惩罚离桌时间。其余时间站起会丢失标记，或以未标记玩家身份结束并结算本轮。</p><p>鱿鱼模式不可保位离桌；后手耗尽时自动补至初始买入。</p></div>}
        {info === "rules" && state.room.specialMode === "NORMAL" && state.room.runItTwiceEnabled && <div className="mt-3 space-y-2 rounded-xl bg-black/25 p-3 text-xs leading-5 text-stone-300"><p>仅在两名玩家进入 All-in 比牌时询问发一次或发两次，选择时间为 5 秒；任一玩家选择发一次或超时，均按一次发牌。</p><p>两人都选择发两次时，已发出的公共牌保持不变，剩余牌分别补成两副公共牌。每个底池分成两半，不能整除时第一副多 1 点。</p><p>两副牌分别结算并保持总筹码守恒，历史牌局记录为同一手的第 1 次和第 2 次。</p></div>}
        {info === "rules" && state.room.specialMode === "SHORT_DECK" && <div className="mt-3 space-y-2 rounded-xl bg-black/25 p-3 text-xs leading-5 text-stone-300"><p>仅使用 6 到 A 共 36 张牌；A-6-7-8-9 是最小顺子。</p><p className="font-semibold text-amber-200">短牌中同花大于葫芦；顺子仍大于三条。</p><p>盲注与行动流程和普通局相同。每手结算后，低于 {state.room.minimumBuyIn.toLocaleString()} 点自动补至下限，高于 {state.room.maximumBuyIn.toLocaleString()} 点自动退至上限，退补同步计入实时战绩。</p></div>}
        {info === "rules" && state.room.specialMode === "BOMB_POT" && <div className="mt-3 space-y-2 rounded-xl bg-black/25 p-3 text-xs leading-5 text-stone-300"><p>牌桌正式开始后，每隔 {state.room.bombPotIntervalMinutes ?? "—"} 分钟，下一手成为暴击局；暂停或人数不足不会重置计时。</p><p>暴击局每名参赛玩家强制投入 {state.room.bombPotBlindMultiplier ?? "—"} BB，包括原本的大小盲；所有人投入相同目标额，不额外叠加普通盲注。</p><p>强制投入后直接发翻牌，不进行翻牌前行动。之后按普通德州规则继续。</p></div>}
        {info === "fees" && <div className="mt-3 space-y-1 rounded-xl bg-black/25 p-3 text-xs leading-5 text-stone-300"><p>每手开局：{state.room.pointFeeRates.handEntry} 钻石</p><p>偷偷看：{state.room.pointFeeRates.paidHandReveal} 钻石</p><p>发发看：{state.room.pointFeeRates.hypotheticalRunout} 钻石</p><p>行动加时：{state.room.pointFeeRates.actionTimeExtension} 钻石</p><p className="pt-1 text-[10px] text-stone-500">钻石供娱乐使用，不可充值、提现或兑换现金。</p></div>}
        {info === "sound" && <div className="mt-3 space-y-3 rounded-xl bg-black/25 p-3 text-xs text-stone-300"><div className="grid grid-cols-2 gap-2" role="group" aria-label="行动语音"><button aria-pressed={voiceGender === "male"} className={`rounded-lg border px-3 py-2 ${voiceGender === "male" ? "border-amber-300 bg-amber-300/15 text-amber-100" : "border-white/10 bg-black/20"}`} onClick={() => onVoiceGenderChange("male")} type="button">男声</button><button aria-pressed={voiceGender === "female"} className={`rounded-lg border px-3 py-2 ${voiceGender === "female" ? "border-amber-300 bg-amber-300/15 text-amber-100" : "border-white/10 bg-black/20"}`} onClick={() => onVoiceGenderChange("female")} type="button">女声</button></div><label className="flex items-center gap-3"><span>音量</span><input aria-label="牌桌音量" className="min-w-0 flex-1 accent-amber-300" max="1" min="0" onChange={(event) => onSoundVolume(Number(event.target.value))} step="0.1" type="range" value={soundVolume} /><output>{Math.round(soundVolume * 100)}%</output></label></div>}
      </section>
    </div>
  );
}
