export function PokerChip({ amount, label = "筹码" }: { readonly amount: number; readonly label?: string }) {
  return (
    <span aria-label={`${label} ${amount.toLocaleString()}`} className="inline-flex max-w-full items-center gap-2 font-semibold text-amber-100">
      <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full border-4 border-dashed border-amber-100/75 bg-rose-800 shadow-md shadow-black/25">
        <span className="size-2 rounded-full bg-amber-100/80" />
      </span>
      <span className="min-w-0 break-all tabular-nums">{amount.toLocaleString()}</span>
    </span>
  );
}

export function StreetCommitment({ amount, compact = false }: { readonly amount: number; readonly compact?: boolean }) {
  if (amount <= 0) return null;
  return (
    <span aria-label={`本街投入 ${amount}`} className={`street-commitment ${compact ? "is-compact" : ""}`}>
      <span aria-hidden="true" className="poker-chip" data-testid="street-commitment-chip"><span /></span>
      <strong>{amount.toLocaleString()}</strong>
    </span>
  );
}
