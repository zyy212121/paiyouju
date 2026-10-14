import type { HypotheticalRunoutResult } from "@paiyouju/shared";
import { Dices } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { createOperationId, readableError } from "../../api/client.js";
import { generateHypotheticalRunout } from "../../api/hands.js";
import { PlayingCard } from "../../components/PlayingCard.js";
import { useNetworkStore } from "../../stores/network-store.js";
import { useAuthStore } from "../../stores/auth-store.js";

export function HypotheticalRunoutView({ board, existingResult = null, handId }: {
  readonly board: readonly string[];
  readonly existingResult?: HypotheticalRunoutResult | null;
  readonly handId: string;
}) {
  const [result, setResult] = useState<HypotheticalRunoutResult | null>(existingResult);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operationId = useRef<string | null>(null);
  const online = useNetworkStore((state) => state.online);
  const updateWallet = useAuthStore((state) => state.updateWalletBalance);
  useEffect(() => {
    setResult(existingResult);
    setError(null);
    operationId.current = null;
  }, [existingResult, handId]);

  if (board.length >= 5) return null;

  async function generate() {
    const durableId = operationId.current ?? createOperationId();
    operationId.current = durableId;
    setWorking(true);
    setError(null);
    try {
      const next = await generateHypotheticalRunout(handId, { operationId: durableId });
      setResult(next.runout);
      updateWallet(next.walletBalance);
      operationId.current = null;
    } catch (caught: unknown) {
      setError(readableError(caught));
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="panel" data-testid="hypothetical-runout">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="section-title">发发看</h2>
        {!result && <button className="secondary-button gap-2" disabled={working || !online} onClick={() => void generate()} type="button"><Dices size={17} />{working ? "生成中…" : online ? "发发看" : "离线"}</button>}
      </div>
      {error && <p className="mt-3 text-sm text-rose-300" role="alert">{error}</p>}
      {result && <div className="mt-4"><div className="flex gap-1" aria-label="发发看公共牌">{result.simulatedBoard.map((card, index) => <PlayingCard code={card} key={`${card}-${index}`} small />)}</div><p className="mt-2 text-xs text-emerald-200">已保存</p></div>}
    </section>
  );
}
