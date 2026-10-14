import { useEffect, useState } from "react";

export function Countdown({ deadline }: { readonly deadline: string | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!deadline) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [deadline]);
  if (!deadline) return null;
  const remaining = Math.max(0, new Date(deadline).getTime() - now);
  return <span className={`font-mono text-sm font-semibold ${remaining <= 5_000 ? "text-rose-300" : "text-amber-200"}`}>{(remaining / 1_000).toFixed(1)}s</span>;
}
