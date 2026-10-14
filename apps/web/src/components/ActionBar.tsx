import type { PlayerIntent, ProjectedLegalActions } from "@paiyouju/shared";
import { useEffect, useMemo, useState } from "react";

interface ActionBarProps {
  readonly disabled: boolean;
  readonly legal: ProjectedLegalActions | null;
  readonly onAction: (intent: PlayerIntent) => Promise<void>;
  readonly pot: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

export function ActionBar({ disabled, legal, onAction, pot }: ActionBarProps) {
  const isRaise = legal?.canRaise === true;
  const minimum = isRaise ? legal.minimumRaiseTo ?? 1 : legal?.minimumBet ?? 1;
  const maximum = isRaise ? legal.maximumRaiseTo ?? minimum : legal?.maximumBet ?? minimum;
  const [amount, setAmount] = useState(minimum);
  const [pending, setPending] = useState(false);
  useEffect(() => { setAmount(minimum); }, [minimum]);
  const shortcuts = useMemo(() => [
    ["1/2 池", pot / 2],
    ["2/3 池", pot * 2 / 3],
    ["满池", pot],
  ] as const, [pot]);
  if (!legal) return <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-center text-sm text-stone-400">等待其他玩家行动</div>;
  const submit = async (intent: PlayerIntent) => {
    if (pending || disabled) return;
    setPending(true);
    try { await onAction(intent); } finally { setPending(false); }
  };
  return (
    <div className="rounded-2xl border border-white/10 bg-[#071a18]/95 p-3 shadow-2xl backdrop-blur sm:p-4">
      {(legal.canBet || legal.canRaise) && <div className="mb-3 grid grid-cols-[1fr_auto] gap-2">
        <input aria-label={isRaise ? "加注至" : "下注金额"} className="field" max={maximum} min={minimum} onChange={(event) => { const raw = event.target.value; if (!/^\d+$/u.test(raw)) return; const value = Number(raw); if (Number.isSafeInteger(value)) setAmount(clamp(value, minimum, maximum)); }} step="1" type="number" value={amount} />
        <span className="self-center text-xs text-stone-400">{minimum}–{maximum}</span>
        <input aria-label="下注滑块" className="col-span-2 accent-amber-300" max={maximum} min={minimum} onChange={(event) => setAmount(Number(event.target.value))} step="1" type="range" value={amount} />
        <div className="col-span-2 flex flex-wrap gap-2">{shortcuts.map(([label, value]) => <button className="mini-button" key={label} onClick={() => setAmount(clamp(value, minimum, maximum))} type="button">{label}</button>)}<button className="mini-button" onClick={() => setAmount(maximum)} type="button">全下值</button></div>
      </div>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {legal.canFold && <button className="action-button border-rose-300/20 bg-rose-400/10 text-rose-100" disabled={disabled || pending} onClick={() => void submit({ type: "fold" })} type="button">弃牌</button>}
        {legal.canCheck && <button className="action-button" disabled={disabled || pending} onClick={() => void submit({ type: "check" })} type="button">过牌</button>}
        {legal.canCall && <button className="action-button" disabled={disabled || pending} onClick={() => void submit({ type: "call" })} type="button">跟注 {legal.callAmount}</button>}
        {legal.canBet && <button className="action-button border-amber-300/30 bg-amber-300/15 text-amber-100" disabled={disabled || pending} onClick={() => void submit({ amount, type: "bet" })} type="button">下注 {amount}</button>}
        {legal.canRaise && <button className="action-button border-amber-300/30 bg-amber-300/15 text-amber-100" disabled={disabled || pending} onClick={() => void submit({ raiseTo: amount, type: "raiseTo" })} type="button">加注至 {amount}</button>}
        {legal.canAllIn && <button className="action-button border-purple-300/30 bg-purple-400/15 text-purple-100" disabled={disabled || pending} onClick={() => void submit({ type: "allIn" })} type="button">全下 {legal.allInTo}</button>}
      </div>
    </div>
  );
}
