import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

function amountForLevel(level: number, maximum: number): number {
  return Math.max(1, Math.ceil(maximum * Math.min(10, Math.max(1, Math.round(level))) / 10));
}

export function BuyInModal({ bigBlind, maximum, onClose, onConfirm, open, working }: {
  readonly bigBlind: number;
  readonly maximum: number;
  readonly onClose: () => void;
  readonly onConfirm: (amount: number) => void;
  readonly open: boolean;
  readonly working: boolean;
}) {
  const [level, setLevel] = useState(10);
  useEffect(() => { if (open) setLevel(10); }, [maximum, open]);
  if (!open) return null;
  const amount = amountForLevel(level, maximum);

  return createPortal(
    <div aria-labelledby="buy-in-title" aria-modal="true" className="modal-backdrop" role="dialog">
      <div className="modal-card">
        <h2 className="text-lg font-semibold" id="buy-in-title">补充牌桌点数</h2>
        <div className="mt-5 text-center">
          <p className="text-3xl font-semibold text-amber-100">{amount.toLocaleString()}</p>
          <p className="mt-1 text-xs text-stone-500">约 {(amount / bigBlind).toFixed(amount % bigBlind === 0 ? 0 : 1)} BB</p>
        </div>
        <label className="mt-5 block text-sm">
          <span className="sr-only">买入档位</span>
          <input aria-label="买入档位" aria-valuetext={`第 ${level} 档，${amount.toLocaleString()} 点`} className="w-full accent-amber-300" max="10" min="1" onChange={(event) => setLevel(Number(event.target.value))} step="1" type="range" value={level} />
        </label>
        <div aria-hidden="true" className="mt-2 grid grid-cols-10 text-center text-[10px] text-stone-500">{Array.from({ length: 10 }, (_, index) => <span key={index}>{index + 1}</span>)}</div>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button className="secondary-button" disabled={working} onClick={onClose} type="button">取消</button>
          <button className="primary-button" disabled={working} onClick={() => onConfirm(amount)} type="button">{working ? "处理中…" : "确认补充"}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
