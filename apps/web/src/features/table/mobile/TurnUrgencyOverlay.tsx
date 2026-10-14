import { Clock3 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

function remainingSeconds(deadline: string | null): number | null {
  if (!deadline) return null;
  const milliseconds = Date.parse(deadline) - Date.now();
  if (!Number.isFinite(milliseconds) || milliseconds <= 0 || milliseconds > 3_000) return null;
  return Math.max(1, Math.ceil(milliseconds / 1_000));
}

export function TurnUrgencyOverlay({ canAfford, deadline, onExtend, onUrgencySecond }: {
  readonly canAfford: boolean;
  readonly deadline: string | null;
  readonly onExtend: () => void;
  readonly onUrgencySecond?: (seconds: number) => void;
}) {
  const [seconds, setSeconds] = useState(() => remainingSeconds(deadline));
  const lastAnnounced = useRef<string | null>(null);
  useEffect(() => {
    setSeconds(remainingSeconds(deadline));
    if (!deadline) return;
    const timer = window.setInterval(() => setSeconds(remainingSeconds(deadline)), 100);
    return () => window.clearInterval(timer);
  }, [deadline]);
  useEffect(() => {
    if (!deadline || seconds === null) {
      if (!deadline) lastAnnounced.current = null;
      return;
    }
    const announcement = `${deadline}:${String(seconds)}`;
    if (lastAnnounced.current === announcement) return;
    lastAnnounced.current = announcement;
    onUrgencySecond?.(seconds);
  }, [deadline, onUrgencySecond, seconds]);
  if (seconds === null) return null;
  return <aside aria-live="assertive" className="turn-urgency-overlay" data-testid="turn-urgency-overlay">
    <span aria-label={`行动剩余 ${seconds} 秒`} className="turn-urgency-count">{seconds}</span>
    <button aria-label="加时" disabled={!canAfford} onClick={onExtend} type="button"><Clock3 aria-hidden="true" />加时</button>
  </aside>;
}
