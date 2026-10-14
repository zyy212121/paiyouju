import { describe, expect, it } from "vitest";

import { walletLedgerDescription, walletLedgerLabel } from "./WalletPage.js";

describe("Wallet ledger wording", () => {
  it("labels every durable Wallet operation", () => {
    expect(["INITIAL_GRANT", "BUY_IN", "CASH_OUT", "PAID_CARD_REVEAL", "HYPOTHETICAL_RUNOUT", "ACTION_TIME_EXTENSION", "HAND_ENTRY_FEE", "ADMIN_ADJUSTMENT"].map((type) => walletLedgerLabel(type as Parameters<typeof walletLedgerLabel>[0]))).toEqual([
      "初始钻石", "旧版点数转入", "旧版点数转出", "偷偷看", "发发看", "行动加时", "每手开局", "管理员调整",
    ]);
    expect(walletLedgerDescription("PAID_CARD_REVEAL")).toContain("购买未公开底牌授权");
    expect(walletLedgerDescription("HYPOTHETICAL_RUNOUT")).toContain("发发看");
    expect(walletLedgerDescription("ACTION_TIME_EXTENSION")).toContain("加时");
    expect(walletLedgerDescription("HAND_ENTRY_FEE")).toContain("开局钻石");
    expect(walletLedgerDescription("BUY_IN")).toContain("新牌局不再发生");
  });
});
