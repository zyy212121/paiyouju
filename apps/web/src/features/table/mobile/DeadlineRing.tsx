import { useEffect, useState } from "react";

export function DeadlineRing({ deadline, durationSeconds, label }: {
  readonly deadline: string | null;
  readonly durationSeconds: number;
  readonly label: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [deadline]);
  if (!deadline) return null;
  const remaining = Math.max(0, Date.parse(deadline) - now);
  const ratio = Math.max(0, Math.min(1, remaining / Math.max(1, durationSeconds * 1_000)));
  return (
    <span
      aria-label={`${label}，剩余 ${(remaining / 1_000).toFixed(1)} 秒`}
      className="deadline-ring"
      data-remaining-ms={remaining}
      style={{ "--deadline-progress": `${ratio * 360}deg` } as React.CSSProperties}
    >
      <span aria-hidden="true">{Math.ceil(remaining / 1_000)}</span>
    </span>
  );
}
