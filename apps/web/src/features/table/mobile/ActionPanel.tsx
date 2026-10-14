import type { NextActionAutopilotMode, NextActionAutopilotProjection, PlayerIntent, ProjectedLegalActions } from "@paiyouju/shared";
import { Check, Coins, ShieldCheck, SlidersVertical } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { DeadlineRing } from "./DeadlineRing.js";
import { RaiseSliderOverlay } from "./RaiseSliderOverlay.js";

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

export function ActionPanel({ actionKey, actionTimeSeconds, activeHand = true, autopilot, canParticipate = true, currentBet, deadline, disabled, legal, onAction, onToggleAutopilot, pot, waitingCallAmount }: {
  readonly actionKey: string;
  readonly actionTimeSeconds: number;
  readonly activeHand?: boolean;
  readonly autopilot: NextActionAutopilotProjection | null;
  readonly canParticipate?: boolean;
  readonly currentBet: number;
  readonly deadline: string | null;
  readonly disabled: boolean;
  readonly legal: ProjectedLegalActions | null;
  readonly onAction: (intent: PlayerIntent) => Promise<void>;
  readonly onToggleAutopilot: (mode: NextActionAutopilotMode) => void;
  readonly pot: number;
  readonly waitingCallAmount: number;
}) {
  const isRaise = legal?.canRaise === true;
  const minimum = isRaise ? legal.minimumRaiseTo ?? 1 : legal?.minimumBet ?? 1;
  const maximum = isRaise ? legal.maximumRaiseTo ?? minimum : legal?.maximumBet ?? minimum;
  const [amount, setAmount] = useState(minimum);
  const [pending, setPending] = useState(false);
  const [sliderOpen, setSliderOpen] = useState(false);
  useEffect(() => setAmount(minimum), [minimum]);
  useEffect(() => setSliderOpen(false), [actionKey]);
  const shortcuts = useMemo(() => {
    const sizingPot = pot + (isRaise ? legal?.callAmount ?? 0 : 0);
    return [
      ["1/3 Pot", sizingPot / 3], ["1/2 Pot", sizingPot / 2], ["2/3 Pot", sizingPot * 2 / 3], ["Pot", sizingPot], ["1.2 Pot", sizingPot * 1.2], ["All-in", maximum - (isRaise ? currentBet : 0)],
    ].map(([label, value]) => ({ label, value: clamp(Number(value) + (isRaise ? currentBet : 0), minimum, maximum) }));
  }, [currentBet, isRaise, legal?.callAmount, maximum, minimum, pot]);
  const setSafeAmount = (value: number) => { if (Number.isFinite(value)) setAmount(clamp(value, minimum, maximum)); };
  const submit = async (intent: PlayerIntent) => {
    if (pending || disabled) return;
    setPending(true);
    try { await onAction(intent); setSliderOpen(false); } finally { setPending(false); }
  };
  const submitSized = () => submit(isRaise ? { raiseTo: amount, type: "raiseTo" } : { amount, type: "bet" });

  if (!canParticipate) return null;
  if (!activeHand) return <section className="mobile-action-panel waiting"><p className="text-xs text-stone-400">等待下一手开始</p></section>;
  if (!legal) return (
    <section className="mobile-action-panel waiting" aria-label="预操作区">
      <div className="preaction-grid">
        <button aria-pressed={autopilot?.mode === "CHECK_OR_FOLD"} className={`autopilot-control ${autopilot?.mode === "CHECK_OR_FOLD" ? "is-pressed" : ""}`} disabled={disabled} onClick={() => onToggleAutopilot("CHECK_OR_FOLD")} type="button"><ShieldCheck aria-hidden="true" size={16} /><span>让或弃</span><Check aria-hidden="true" className="preaction-check" size={13} /></button>
        {waitingCallAmount > 0 && <button aria-pressed={autopilot?.mode === "CALL"} className={`autopilot-control auto-call ${autopilot?.mode === "CALL" ? "is-pressed" : ""}`} disabled={disabled} onClick={() => onToggleAutopilot("CALL")} type="button"><Coins aria-hidden="true" size={16} /><span>自动跟注 {waitingCallAmount}</span><Check aria-hidden="true" className="preaction-check" size={13} /></button>}
      </div>
      <p className="preaction-help">让或弃：能让则让，否则弃牌{waitingCallAmount > 0 ? " · 自动跟注：下注变化时自动取消" : ""}</p>
      {waitingCallAmount > 0 && <span className="sr-only">下注变化时自动取消</span>}
    </section>
  );

  return <section className="mobile-action-panel" data-testid="action-panel"><div className="action-pot-summary"><span>当前下注 {currentBet.toLocaleString()}</span><span>底池 {pot.toLocaleString()}</span></div>{(legal.canBet || legal.canRaise) && <div className="quick-bet-grid" aria-label="快捷加注">{shortcuts.map((shortcut) => <button aria-label={`${shortcut.label}，加注至 ${shortcut.value}`} className="quick-bet-button" disabled={disabled || pending} key={shortcut.label} onClick={() => void submit(isRaise ? { raiseTo: shortcut.value, type: "raiseTo" } : { amount: shortcut.value, type: "bet" })} type="button"><span>{shortcut.label}</span><strong>{shortcut.value}</strong></button>)}</div>}<div className="main-action-grid">{legal.canFold && <button className="mobile-action fold-action" disabled={disabled || pending} onClick={() => void submit({ type: "fold" })} type="button"><DeadlineRing deadline={deadline} durationSeconds={actionTimeSeconds} label="我的行动倒计时" /><span>弃牌</span></button>}{legal.canCheck ? <button className="mobile-action" disabled={disabled || pending} onClick={() => void submit({ type: "check" })} type="button">过牌</button> : legal.canCall ? <button className="mobile-action" disabled={disabled || pending} onClick={() => void submit({ type: "call" })} type="button">跟注 <span>{legal.callAmount}</span></button> : <span />}{(legal.canBet || legal.canRaise) ? <button className="mobile-action raise-action" disabled={disabled || pending} onClick={() => setSliderOpen(true)} type="button"><SlidersVertical size={16} />{isRaise ? "加注至" : "下注"} {amount}</button> : legal.canAllIn ? <button className="mobile-action raise-action" disabled={disabled || pending} onClick={() => void submit({ type: "allIn" })} type="button">全下 {legal.allInTo}</button> : <span />}</div><RaiseSliderOverlay amount={amount} callAmount={legal.callAmount} currentBet={currentBet} isRaise={isRaise} label={isRaise ? "加注至" : "下注"} maximum={maximum} minimum={minimum} onAmount={setSafeAmount} onClose={() => setSliderOpen(false)} onConfirm={() => void submitSized()} open={sliderOpen} pending={pending} pot={pot} /></section>;
}
