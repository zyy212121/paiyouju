const suitSymbols = { c: "♣", d: "♦", h: "♥", s: "♠" } as const;

export type CardSize = "compact" | "normal" | "large";
export type CardSuit = keyof typeof suitSymbols;

const sizeClasses: Readonly<Record<CardSize, string>> = {
  compact: "h-12 w-8 text-xs",
  large: "h-24 w-16 text-lg",
  normal: "h-16 w-11 text-sm",
};

interface CardVisualProps {
  readonly highlighted?: boolean;
  readonly size?: CardSize;
  /** Backward-compatible alias used by compact table and history layouts. */
  readonly small?: boolean;
}

interface PlayingCardProps extends CardVisualProps {
  readonly code: string;
  readonly faceDown?: boolean;
  readonly faceUp?: boolean;
}

export function SuitSymbol({ suit }: { readonly suit: CardSuit }) {
  return <span aria-hidden="true">{suitSymbols[suit]}</span>;
}

export function PlayingCard({ code, faceDown = false, faceUp = true, highlighted = false, size = "normal", small = false }: PlayingCardProps) {
  const actualSize = small ? "compact" : size;
  if (faceDown || !faceUp) return <CardBack highlighted={highlighted} size={actualSize} />;
  const canonicalRank = code.slice(0, -1);
  const rank = canonicalRank === "T" ? "10" : canonicalRank;
  const suit = code.at(-1) as CardSuit | undefined;
  const symbol = suit ? suitSymbols[suit] : undefined;
  const red = suit === "h" || suit === "d";
  return (
    <span
      aria-label={`${rank}${symbol ?? ""}`}
      className={`${sizeClasses[actualSize]} playing-card-face shrink-0 rounded-lg border bg-stone-50 font-bold ${highlighted ? "border-amber-300 ring-2 ring-amber-300/45" : "border-stone-200"} ${red ? "text-rose-600" : "text-slate-900"} shadow-lg animate-[card-in_.25s_ease-out]`}
      data-card-code={code}
      data-card-rank={rank}
      role="img"
    >
      <span className="playing-card-rank">{rank}</span>
      <span className="playing-card-suit">{suit && <SuitSymbol suit={suit} />}</span>
    </span>
  );
}

export function CardBack({ highlighted = false, size = "normal", small = false }: CardVisualProps) {
  const actualSize = small ? "compact" : size;
  return (
    <span
      aria-label="隐藏底牌"
      className={`${sizeClasses[actualSize]} grid shrink-0 place-items-center overflow-hidden rounded-lg border ${highlighted ? "border-amber-300 ring-2 ring-amber-300/45" : "border-teal-100/35"} bg-[#0d4b43] shadow-lg`}
      role="img"
    >
      <span aria-hidden="true" className="size-[78%] rounded border border-amber-100/30 bg-[repeating-linear-gradient(45deg,#123f3b,#123f3b_4px,#1a655b_4px,#1a655b_8px)]" />
    </span>
  );
}
