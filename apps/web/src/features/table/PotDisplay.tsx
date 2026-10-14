export function PotDisplay({ mainPot, sidePots }: { readonly mainPot: number; readonly sidePots: readonly number[] }) {
  return <p className="mt-1 text-sm font-semibold text-amber-200" data-testid="pots">主 {mainPot.toLocaleString()}{sidePots.length > 0 && ` · 边 ${sidePots.map((pot) => pot.toLocaleString()).join(" / ")}`}</p>;
}
