-- Room members may purchase history entitlements without having participated
-- in the target hand. Hand/room/user/wallet integrity and reveal-target
-- participation constraints remain enforced.

ALTER TABLE "PaidCardReveal"
  DROP CONSTRAINT "PaidCardReveal_buyer_participant_fkey";

ALTER TABLE "PaidHandRevealPurchase"
  DROP CONSTRAINT "PaidHandRevealPurchase_buyer_participant_fkey";

ALTER TABLE "HypotheticalRunoutPurchase"
  DROP CONSTRAINT "HypotheticalRunoutPurchase_handId_buyerUserId_fkey";
