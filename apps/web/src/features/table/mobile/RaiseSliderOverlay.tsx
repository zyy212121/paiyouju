import { X } from "lucide-react";
import { createPortal } from "react-dom";

export function RaiseSliderOverlay({ amount, callAmount, currentBet, isRaise, label, maximum, minimum, onAmount, onClose, onConfirm, open, pending, pot }: {
  readonly amount: number;
  readonly callAmount: number;
  readonly currentBet: number;
  readonly isRaise: boolean;
  readonly label: string;
  readonly maximum: number;
  readonly minimum: number;
  readonly onAmount: (value: number) => void;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
  readonly open: boolean;
  readonly pending: boolean;
  readonly pot: number;
}) {
  if (!open) return null;
  const sizingPot = pot + (isRaise ? callAmount : 0);
  const wagerAmount = isRaise ? amount - currentBet : amount;
  const ratio = sizingPot > 0 && wagerAmount >= 0 ? wagerAmount / sizingPot : null;
  return createPortal(<div aria-labelledby="raise-slider-title" aria-modal="true" className="modal-backdrop" role="dialog"><section className="raise-slider-card"><header className="flex items-center justify-between"><div><p className="text-xs text-stone-500">下注范围 {minimum.toLocaleString()}–{maximum.toLocaleString()}</p><h2 className="text-lg font-semibold" id="raise-slider-title">{label} {amount.toLocaleString()}</h2>{ratio !== null && <p className="text-xs text-amber-200">约 {ratio.toFixed(2)} Pot</p>}</div><button aria-label="关闭加注器" className="table-icon-button" onClick={onClose} type="button"><X /></button></header><div className="mt-5 grid grid-cols-[1fr_5rem] items-center gap-4"><div><input aria-label="精确下注金额" className="field text-center text-xl font-semibold" inputMode="numeric" max={maximum} min={minimum} onChange={(event) => onAmount(Number(event.target.value))} step="1" type="number" value={amount} /><div className="mt-4 grid grid-cols-2 gap-2"><button className="mini-button" onClick={() => onAmount(minimum)} type="button">最小</button><button className="mini-button" onClick={() => onAmount(maximum)} type="button">最大 / All-in</button></div><button className="primary-button mt-5 w-full" disabled={pending} onClick={onConfirm} type="button">{pending ? "提交中…" : `确认${label} ${amount.toLocaleString()}`}</button></div><div className="vertical-bet-slider-shell"><output className="vertical-bet-value">{amount.toLocaleString()}</output><input aria-label="竖向加注滑杆" aria-valuetext={`${label} ${amount}`} className="vertical-bet-slider" max={maximum} min={minimum} onChange={(event) => onAmount(Number(event.target.value))} step="1" type="range" value={amount} /></div></div></section></div>, document.body);
}
