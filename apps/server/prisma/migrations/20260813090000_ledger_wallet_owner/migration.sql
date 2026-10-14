-- The audit row's user must be the owner of the referenced wallet. This keeps
-- user-scoped ledger reads and the wallet audit chain consistent even if a
-- caller bypasses the Wallet Service.
CREATE UNIQUE INDEX "Wallet_id_userId_key" ON "Wallet"("id", "userId");

ALTER TABLE "WalletLedgerEntry"
  DROP CONSTRAINT "WalletLedgerEntry_walletId_fkey";

ALTER TABLE "WalletLedgerEntry"
  ADD CONSTRAINT "WalletLedgerEntry_walletId_userId_fkey"
  FOREIGN KEY ("walletId", "userId")
  REFERENCES "Wallet"("id", "userId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
