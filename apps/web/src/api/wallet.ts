import { apiRequest, type WalletSummary } from "./client.js";

export type WalletLedgerType =
  | "INITIAL_GRANT"
  | "BUY_IN"
  | "CASH_OUT"
  | "PAID_CARD_REVEAL"
  | "HYPOTHETICAL_RUNOUT"
  | "ACTION_TIME_EXTENSION"
  | "HAND_ENTRY_FEE"
  | "ADMIN_ADJUSTMENT";

export interface WalletLedgerEntry {
  readonly balanceAfter: number;
  readonly balanceBefore: number;
  readonly createdAt: string;
  readonly id: string;
  readonly relatedGameSessionId: string | null;
  readonly relatedHandId: string | null;
  readonly relatedRoomId: string | null;
  readonly sequence: number;
  readonly signedAmount: number;
  readonly type: WalletLedgerType;
}

export interface WalletLedgerPage {
  readonly entries: readonly WalletLedgerEntry[];
  readonly nextCursor?: number;
}

export const getWallet = (signal?: AbortSignal) => apiRequest<WalletSummary>("/api/wallet", signal ? { signal } : {});
export const listWalletLedger = (cursor?: number, signal?: AbortSignal) => apiRequest<WalletLedgerPage>(
  `/api/wallet/ledger?limit=25${cursor ? `&cursor=${cursor}` : ""}`,
  signal ? { signal } : {},
);
