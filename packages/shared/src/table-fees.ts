export const DIAMOND_FEE_BASE = 10 as const;

export interface TableDiamondFees {
  readonly actionTimeExtension: number;
  readonly handEntry: number;
  readonly hypotheticalRunout: number;
  readonly paidHandReveal: number;
}

export function tableDiamondFees(): TableDiamondFees {
  return {
    actionTimeExtension: DIAMOND_FEE_BASE,
    handEntry: DIAMOND_FEE_BASE,
    hypotheticalRunout: DIAMOND_FEE_BASE,
    paidHandReveal: DIAMOND_FEE_BASE * 5,
  };
}
