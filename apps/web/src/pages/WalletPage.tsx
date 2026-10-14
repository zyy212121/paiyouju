import { Diamond, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { readableError, type WalletSummary } from "../api/client.js";
import { getWallet, listWalletLedger, type WalletLedgerEntry } from "../api/wallet.js";
import { formatDateTime, signedPoints } from "../features/history/history-format.js";
import { useAuthStore } from "../stores/auth-store.js";
import { useNetworkStore } from "../stores/network-store.js";

const typeLabels: Readonly<Record<WalletLedgerEntry["type"], string>> = {
  ADMIN_ADJUSTMENT: "管理员调整",
  BUY_IN: "旧版点数转入",
  CASH_OUT: "旧版点数转出",
  INITIAL_GRANT: "初始钻石",
  PAID_CARD_REVEAL: "偷偷看",
  HYPOTHETICAL_RUNOUT: "发发看",
  ACTION_TIME_EXTENSION: "行动加时",
  HAND_ENTRY_FEE: "每手开局",
};

const descriptions: Readonly<Record<WalletLedgerEntry["type"], string>> = {
  ADMIN_ADJUSTMENT: "管理员调整个人 Wallet",
  BUY_IN: "迁移前的历史转换；新牌局不再发生",
  CASH_OUT: "迁移前的历史转换；新牌局不再发生",
  INITIAL_GRANT: "注册时创建的初始钻石",
  PAID_CARD_REVEAL: "牌局结束后购买未公开底牌授权",
  HYPOTHETICAL_RUNOUT: "牌局结束后生成并保存唯一发发看结果",
  ACTION_TIME_EXTENSION: "行动倒计时最后三秒购买加时",
  HAND_ENTRY_FEE: "参与一手牌时支付固定开局钻石",
};

export const walletLedgerLabel = (type: WalletLedgerEntry["type"]): string => typeLabels[type];
export const walletLedgerDescription = (type: WalletLedgerEntry["type"]): string => descriptions[type];

export function WalletPage() {
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [entries, setEntries] = useState<readonly WalletLedgerEntry[]>([]);
  const [cursor, setCursor] = useState<number | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const syncBalance = useAuthStore((state) => state.updateWalletBalance);
  const refreshVersion = useNetworkStore((state) => state.refreshVersion);
  const requestEpoch = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const load = useCallback(async (next?: number) => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const epoch = requestEpoch.current + 1;
    requestEpoch.current = epoch;
    setLoading(true);
    setError(null);
    try {
      const [summary, page] = await Promise.all([getWallet(controller.signal), listWalletLedger(next, controller.signal)]);
      if (controller.signal.aborted || requestEpoch.current !== epoch) return;
      setWallet(summary);
      syncBalance(summary.balance);
      setEntries((current) => next !== undefined ? [...current, ...page.entries] : page.entries);
      setCursor(page.nextCursor);
    } catch (caught: unknown) {
      if (!controller.signal.aborted && requestEpoch.current === epoch) setError(readableError(caught));
    } finally {
      if (requestEpoch.current === epoch) setLoading(false);
    }
  }, [refreshVersion, syncBalance]);

  useEffect(() => {
    void load();
    return () => activeRequest.current?.abort();
  }, [load]);
  return (
    <section className="space-y-5">
      <header>
        <p className="eyebrow"><Diamond size={15} /> 钻石账户</p>
        <h1 className="page-title">{wallet ? `${wallet.balance.toLocaleString()} 钻石` : "我的钻石"}</h1>
        <p className="page-subtitle">{wallet ? `更新于 ${formatDateTime(wallet.updatedAt)}` : "显示最近 30 天钻石流水。"}</p>
      </header>
      {error && <p className="error-banner" role="alert">{error}</p>}
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="text-xs text-stone-500"><tr><th className="pb-3">时间</th><th className="pb-3">类型</th><th className="pb-3">金额</th><th className="pb-3">变更前</th><th className="pb-3">变更后</th><th className="pb-3">关联房间</th><th className="pb-3">关联 Hand</th><th className="pb-3">说明</th></tr></thead>
          <tbody className="divide-y divide-white/10">
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="py-3 text-stone-400">{formatDateTime(entry.createdAt)}</td>
                <td className="py-3">{walletLedgerLabel(entry.type)}</td>
                <td className={`py-3 font-semibold ${entry.signedAmount >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{signedPoints(entry.signedAmount)}</td>
                <td className="py-3">{entry.balanceBefore.toLocaleString()}</td>
                <td className="py-3">{entry.balanceAfter.toLocaleString()}</td>
                <td className="py-3 text-xs text-stone-400">{entry.relatedRoomId ? entry.relatedRoomId.slice(0, 8) : "—"}</td>
                <td className="py-3 text-xs">{entry.relatedHandId ? <Link className="text-amber-200 underline-offset-2 hover:underline" to={`/hands/${entry.relatedHandId}`}>{entry.relatedHandId.slice(0, 8)}</Link> : "—"}</td>
                <td className="py-3 text-xs text-stone-400">{walletLedgerDescription(entry.type)}{entry.relatedGameSessionId ? ` · 对局 ${entry.relatedGameSessionId.slice(0, 8)}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && entries.length === 0 && <p className="py-8 text-center text-stone-500">暂无流水</p>}
      </div>
      <div className="flex justify-center">{loading ? <LoaderCircle aria-label="加载中" className="animate-spin" /> : cursor && <button className="secondary-button" onClick={() => void load(cursor)} type="button">加载更多</button>}</div>
    </section>
  );
}
