import type { PaidHandRevealResult } from "@paiyouju/shared";
import { Eye } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { createOperationId, HttpApiError, readableError } from "../api/client.js";
import { buyPaidHandReveal } from "../api/hands.js";
import { useAuthStore } from "../stores/auth-store.js";
import { useNetworkStore } from "../stores/network-store.js";

export function PaidRevealButton({ cost, handId, onPurchased }: {
  readonly cost: number;
  readonly handId: string;
  readonly onPurchased?: (result: PaidHandRevealResult) => Promise<void> | void;
}) {
  const [insufficientBalance, setInsufficientBalance] = useState(false);
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [operationId, setOperationId] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  const purchaseScope = handId;
  const activeScope = useRef(purchaseScope);
  activeScope.current = purchaseScope;
  const user = useAuthStore((state) => state.user);
  const updateWalletBalance = useAuthStore((state) => state.updateWalletBalance);
  const online = useNetworkStore((state) => state.online);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    setBuying(false);
    setError(null);
    setInsufficientBalance(false);
    setOperationId(null);
  }, [purchaseScope]);

  useEffect(() => {
    if (!insufficientBalance) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setInsufficientBalance(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      triggerRef.current?.focus();
    };
  }, [insufficientBalance]);

  async function purchase() {
    if (buying || !online) return;
    if (user && user.walletBalance < cost) {
      setError(null);
      setInsufficientBalance(true);
      return;
    }
    const buyerUserId = user?.id;
    const requestedScope = purchaseScope;
    const durableOperationId = operationId ?? createOperationId();
    setOperationId(durableOperationId);
    setBuying(true);
    setError(null);
    let result: PaidHandRevealResult;
    try {
      result = await buyPaidHandReveal(handId, { operationId: durableOperationId });
    } catch (caught: unknown) {
      if (!mounted.current || activeScope.current !== requestedScope) return;
      if (caught instanceof HttpApiError && caught.code === "INSUFFICIENT_WALLET_BALANCE") {
        setInsufficientBalance(true);
        setError(null);
      } else {
        setError(readableError(caught));
      }
      const resultIsUncertain = caught instanceof HttpApiError
        && (caught.code === "REQUEST_TIMEOUT" || caught.code === "NETWORK_ERROR");
      if (!resultIsUncertain) setOperationId(null);
      setBuying(false);
      return;
    }

    if (buyerUserId !== undefined && useAuthStore.getState().user?.id === buyerUserId) updateWalletBalance(result.walletBalance);
    if (!mounted.current || activeScope.current !== requestedScope) return;
    setOperationId(null);
    setBuying(false);
    try {
      await onPurchased?.(result);
    } catch (caught: unknown) {
      setError(`购买已完成，但页面刷新失败：${readableError(caught)}`);
    }
  }

  return (
    <>
      <button className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg border border-amber-300/25 px-3 text-sm text-amber-200" disabled={buying || !online} onClick={() => void purchase()} ref={triggerRef} type="button">
        <Eye size={16} /> {buying ? "处理中…" : online ? `偷偷看 ${cost}钻石` : "离线不可购买"}
      </button>
      {error && <p className="mt-2 text-xs text-rose-300" role="alert">{error}</p>}
      {insufficientBalance && createPortal(<div aria-labelledby="paid-hand-reveal-balance-title" aria-modal="true" className="modal-backdrop" role="dialog"><div className="modal-card"><h2 className="text-lg font-semibold" id="paid-hand-reveal-balance-title">钻石余额不足</h2><p className="mt-3 text-sm text-stone-300">偷偷看需要 <strong className="text-amber-200">{cost.toLocaleString()} 钻石</strong>，当前余额为 <strong className="text-amber-200">{user?.walletBalance.toLocaleString() ?? "—"}</strong>。</p><button className="primary-button mt-5 w-full" onClick={() => setInsufficientBalance(false)} type="button">关闭</button></div></div>, document.body)}
    </>
  );
}
