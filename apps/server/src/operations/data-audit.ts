import type { DatabaseClient } from "../db/client.js";
import { Prisma } from "../generated/prisma/client.js";
import { normalizeTableSnapshotPayload } from "../modules/tables/snapshot/snapshot-codec.js";
import { TableSnapshotPayloadSchema } from "../modules/tables/snapshot/snapshot-schema.js";

export interface DataAuditCheck {
  readonly code: string;
  readonly count: number;
  readonly status: "PASS" | "FAIL";
}

export interface DataAuditReport {
  readonly checkedAt: string;
  readonly checkCount: number;
  readonly checks: readonly DataAuditCheck[];
  readonly failureCount: number;
  readonly ok: boolean;
}

interface SqlCheck {
  readonly code: string;
  readonly query: Prisma.Sql;
}

const SQL_CHECKS: readonly SqlCheck[] = [
  {
    code: "USER_WALLET_CARDINALITY",
    query: Prisma.sql`
      SELECT COUNT(*)::BIGINT AS count FROM (
        SELECT u."id" FROM "User" u
        LEFT JOIN "Wallet" w ON w."userId" = u."id"
        GROUP BY u."id" HAVING COUNT(w."id") <> 1
      ) violations
    `,
  },
  {
    code: "PHONE_UNIQUENESS",
    query: Prisma.sql`
      SELECT COUNT(*)::BIGINT AS count FROM (
        SELECT "phoneNumber" FROM "User" WHERE "phoneNumber" IS NOT NULL
        GROUP BY "phoneNumber" HAVING COUNT(*) <> 1
      ) violations
    `,
  },
  {
    code: "WALLET_BOUNDS",
    query: Prisma.sql`SELECT COUNT(*)::BIGINT AS count FROM "Wallet" WHERE "balance" < 0 OR "balance" > 2000000000`,
  },
  {
    code: "WALLET_TAIL_MISMATCH",
    query: Prisma.sql`
      SELECT COUNT(*)::BIGINT AS count FROM "Wallet" wallet
      LEFT JOIN LATERAL (
        SELECT entry."balanceAfter", entry."sequence"
        FROM "WalletLedgerEntry" entry
        WHERE entry."walletId" = wallet."id"
        ORDER BY entry."sequence" DESC LIMIT 1
      ) tail ON TRUE
      WHERE tail."sequence" IS NOT NULL
        AND (
          tail."sequence" > wallet."version"
          OR (
            tail."sequence" = wallet."version"
            AND tail."balanceAfter" <> wallet."balance"
          )
        )
    `,
  },
  {
    code: "WALLET_LEDGER_CHAIN",
    query: Prisma.sql`
      SELECT COUNT(*)::BIGINT AS count FROM (
        SELECT entry."sequence", entry."balanceBefore", entry."balanceAfter", entry."signedAmount",
          LAG(entry."sequence") OVER (PARTITION BY entry."walletId" ORDER BY entry."sequence") AS previous_sequence,
          LAG(entry."balanceAfter") OVER (PARTITION BY entry."walletId" ORDER BY entry."sequence") AS previous_balance
        FROM "WalletLedgerEntry" entry
      ) ordered
      WHERE ordered."balanceAfter" <> ordered."balanceBefore" + ordered."signedAmount"
        OR (
          ordered.previous_sequence IS NOT NULL
          -- Room retention/deletion may remove related entries and leave an intentional gap.
          -- Continuity is provable only when both adjacent sequence numbers remain.
          AND ordered."sequence" = ordered.previous_sequence + 1
          AND ordered."balanceBefore" <> ordered.previous_balance
        )
    `,
  },
  {
    code: "TABLE_STACK_BOUNDS",
    query: Prisma.sql`SELECT COUNT(*)::BIGINT AS count FROM "TableSeat" WHERE "stack" < 0 OR "stack" > 2000000000`,
  },
  {
    code: "ACTIVE_SEAT_SESSION",
    query: Prisma.sql`
      SELECT COUNT(*)::BIGINT AS count FROM "TableSeat" seat
      JOIN "GameSession" session ON session."id" = seat."gameSessionId"
      WHERE session."status" <> 'ACTIVE'::"GameSessionStatus"
    `,
  },
  {
    code: "CLOSED_SESSION_ACTIVE_SEAT",
    query: Prisma.sql`
      SELECT COUNT(*)::BIGINT AS count FROM "GameSession" session
      JOIN "TableSeat" seat ON seat."gameSessionId" = session."id"
      WHERE session."status" = 'CLOSED'::"GameSessionStatus"
    `,
  },
  {
    code: "TABLE_LEDGER_CHAIN",
    query: Prisma.sql`
      SELECT COUNT(*)::BIGINT AS count FROM (
        SELECT entry."sequence", entry."stackBefore", entry."stackAfter", entry."signedAmount",
          ROW_NUMBER() OVER (PARTITION BY entry."gameSessionId" ORDER BY entry."sequence") AS expected_sequence,
          LAG(entry."stackAfter", 1, 0) OVER (PARTITION BY entry."gameSessionId" ORDER BY entry."sequence") AS expected_before
        FROM "TableStackLedgerEntry" entry
      ) ordered
      WHERE ordered."sequence" <> ordered.expected_sequence
        OR ordered."stackBefore" <> ordered.expected_before
        OR ordered."stackAfter" <> ordered."stackBefore" + ordered."signedAmount"
    `,
  },
  {
    code: "BUY_IN_CASH_OUT_PAIRING",
    query: Prisma.sql`
      SELECT COUNT(*)::BIGINT AS count FROM "TableStackLedgerEntry"
      WHERE "type" IN ('BUY_IN'::"TableStackLedgerType", 'CASH_OUT'::"TableStackLedgerType")
        AND (
          (
            "walletLedgerEntryId" IS NULL
            AND ("walletSignedAmount" IS NOT NULL OR "walletType" IS NOT NULL)
          )
          OR
          (
            "walletLedgerEntryId" IS NOT NULL
            AND (
              "walletSignedAmount" IS NULL
              OR "walletSignedAmount" <> -"signedAmount"
              OR "walletType"::TEXT <> "type"::TEXT
            )
          )
        )
    `,
  },
  {
    code: "GAME_SESSION_STACK_RECONCILIATION",
    query: Prisma.sql`
      SELECT COUNT(*)::BIGINT AS count FROM "GameSession" session
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(entry."signedAmount"), 0)::BIGINT AS ledger_stack
        FROM "TableStackLedgerEntry" entry WHERE entry."gameSessionId" = session."id"
      ) totals ON TRUE
      LEFT JOIN "TableSeat" seat ON seat."gameSessionId" = session."id"
      WHERE totals.ledger_stack <> COALESCE(seat."stack", 0)
    `,
  },
  {
    code: "HAND_RESULT_ZERO_SUM",
    query: Prisma.sql`
      SELECT COUNT(*)::BIGINT AS count FROM (
        SELECT "handId" FROM "TableStackLedgerEntry"
        WHERE "type" = 'HAND_RESULT'::"TableStackLedgerType"
        GROUP BY "handId" HAVING SUM("signedAmount") <> 0
      ) violations
    `,
  },
  {
    code: "SQUID_SETTLEMENT_ZERO_SUM",
    query: Prisma.sql`
      SELECT COUNT(*)::BIGINT AS count FROM (
        SELECT "roomId", "metadata"->>'roundNumber' AS round_number
        FROM "TableStackLedgerEntry"
        WHERE "type" = 'SQUID_SETTLEMENT'::"TableStackLedgerType"
        GROUP BY "roomId", "metadata"->>'roundNumber'
        HAVING SUM("signedAmount") <> 0
          OR BOOL_OR("metadata"->>'roundNumber' IS NULL)
      ) violations
    `,
  },
  {
    code: "HAND_NUMBER_UNIQUENESS",
    query: Prisma.sql`
      SELECT COUNT(*)::BIGINT AS count FROM (
        SELECT "roomId", "handNumber" FROM "HandRecord"
        GROUP BY "roomId", "handNumber" HAVING COUNT(*) <> 1
      ) violations
    `,
  },
  {
    code: "HAND_PLAYER_ZERO_SUM",
    query: Prisma.sql`
      SELECT COUNT(*)::BIGINT AS count FROM (
        SELECT "handId" FROM "HandPlayerRecord"
        GROUP BY "handId" HAVING SUM("netResult") <> 0
      ) violations
    `,
  },
  {
    code: "HAND_POT_AWARD_MISMATCH",
    query: Prisma.sql`
      SELECT COUNT(*)::BIGINT AS count FROM "HandRecord" hand
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(player."committed"), 0)::BIGINT AS committed
        FROM "HandPlayerRecord" player
        WHERE player."handId" = hand."id"
      ) players ON TRUE
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(pot."amount"), 0)::BIGINT AS amount
        FROM "HandPotRecord" pot WHERE pot."handId" = hand."id"
      ) pots ON TRUE
      WHERE
        players.committed <> pots.amount
        OR EXISTS (
          SELECT 1 FROM "HandPotRecord" pot
          WHERE pot."handId" = hand."id" AND (
            CARDINALITY(pot."contributors") < 1
            OR CARDINALITY(pot."eligiblePlayers") < 1
            OR CARDINALITY(pot."winners") < 1
            OR CARDINALITY(pot."contributors") <> (
              SELECT COUNT(DISTINCT participant) FROM UNNEST(pot."contributors") participant
            )
            OR CARDINALITY(pot."eligiblePlayers") <> (
              SELECT COUNT(DISTINCT participant) FROM UNNEST(pot."eligiblePlayers") participant
            )
            OR CARDINALITY(pot."winners") <> (
              SELECT COUNT(DISTINCT participant) FROM UNNEST(pot."winners") participant
            )
            OR CARDINALITY(pot."oddChipRecipients") <> (
              SELECT COUNT(DISTINCT participant) FROM UNNEST(pot."oddChipRecipients") participant
            )
            OR EXISTS (
              SELECT 1 FROM UNNEST(pot."contributors") participant
              WHERE NOT EXISTS (
                SELECT 1 FROM "HandPlayerRecord" player
                WHERE player."handId" = hand."id" AND player."userId" = participant
              )
            )
            OR EXISTS (
              SELECT 1 FROM UNNEST(pot."eligiblePlayers") participant
              WHERE NOT participant = ANY(pot."contributors")
            )
            OR EXISTS (
              SELECT 1 FROM UNNEST(pot."winners") participant
              WHERE NOT participant = ANY(pot."eligiblePlayers")
            )
            OR EXISTS (
              SELECT 1 FROM UNNEST(pot."oddChipRecipients") participant
              WHERE NOT participant = ANY(pot."winners")
            )
            OR (hand."runoutCount" = 1 AND MOD(pot."amount", CARDINALITY(pot."winners")) <> CARDINALITY(pot."oddChipRecipients"))
          )
        )
        OR (hand."runoutCount" = 1 AND EXISTS (
          SELECT 1
          FROM "HandPlayerRecord" player
          LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(
              pot."amount" / CARDINALITY(pot."winners")
              + CASE WHEN player."userId" = ANY(pot."oddChipRecipients") THEN 1 ELSE 0 END
            ), 0)::BIGINT AS amount
            FROM "HandPotRecord" pot
            WHERE pot."handId" = hand."id" AND player."userId" = ANY(pot."winners")
          ) player_awards ON TRUE
          WHERE player."handId" = hand."id"
            AND player."netResult" + player."committed" <> player_awards.amount
        ))
        OR (hand."runoutCount" = 2 AND (
          (SELECT COUNT(*) FROM "HandRunoutRecord" runout WHERE runout."handId" = hand."id") <> 2
          OR (SELECT COALESCE(SUM(pot."amount"), 0) FROM "HandRunoutPotRecord" pot WHERE pot."handId" = hand."id") <> players.committed
          OR EXISTS (
            SELECT 1 FROM "HandRunoutPotRecord" pot
            WHERE pot."handId" = hand."id" AND (
              CARDINALITY(pot."contributors") < 1
              OR CARDINALITY(pot."eligiblePlayers") < 1
              OR CARDINALITY(pot."winners") < 1
              OR CARDINALITY(pot."contributors") <> (SELECT COUNT(DISTINCT participant) FROM UNNEST(pot."contributors") participant)
              OR CARDINALITY(pot."eligiblePlayers") <> (SELECT COUNT(DISTINCT participant) FROM UNNEST(pot."eligiblePlayers") participant)
              OR CARDINALITY(pot."winners") <> (SELECT COUNT(DISTINCT participant) FROM UNNEST(pot."winners") participant)
              OR CARDINALITY(pot."oddChipRecipients") <> (SELECT COUNT(DISTINCT participant) FROM UNNEST(pot."oddChipRecipients") participant)
              OR EXISTS (SELECT 1 FROM UNNEST(pot."eligiblePlayers") participant WHERE NOT participant = ANY(pot."contributors"))
              OR EXISTS (SELECT 1 FROM UNNEST(pot."winners") participant WHERE NOT participant = ANY(pot."eligiblePlayers"))
              OR EXISTS (SELECT 1 FROM UNNEST(pot."oddChipRecipients") participant WHERE NOT participant = ANY(pot."winners"))
              OR MOD(pot."amount", CARDINALITY(pot."winners")) <> CARDINALITY(pot."oddChipRecipients")
            )
          )
          OR EXISTS (
            SELECT 1
            FROM "HandPlayerRecord" player
            LEFT JOIN LATERAL (
              SELECT COALESCE(SUM(
                pot."amount" / CARDINALITY(pot."winners")
                + CASE WHEN player."userId" = ANY(pot."oddChipRecipients") THEN 1 ELSE 0 END
              ), 0)::BIGINT AS amount
              FROM "HandRunoutPotRecord" pot
              WHERE pot."handId" = hand."id" AND player."userId" = ANY(pot."winners")
            ) player_awards ON TRUE
            WHERE player."handId" = hand."id"
              AND player."netResult" + player."committed" <> player_awards.amount
          )
        ))
    `,
  },
  {
    code: "SELECTED_REVEAL_STATE",
    query: Prisma.sql`
      SELECT COUNT(*)::BIGINT AS count FROM "HandPlayerRecord" player
      WHERE CASE
        WHEN player."holeCardsPublicReason" = 'SHOWDOWN'::"HoleCardsPublicReason"
          THEN NOT player."holeCardsPublic" OR CARDINALITY(player."voluntarilyRevealedCardIndices") <> 0
        WHEN player."holeCardsPublicReason" = 'VOLUNTARY'::"HoleCardsPublicReason"
          THEN player."voluntarilyRevealedAt" IS NULL
            OR CARDINALITY(player."voluntarilyRevealedCardIndices") NOT BETWEEN 1 AND 2
            OR player."holeCardsPublic" <> (CARDINALITY(player."voluntarilyRevealedCardIndices") = 2)
            OR EXISTS (
              SELECT 1 FROM UNNEST(player."voluntarilyRevealedCardIndices") value
              WHERE value NOT IN (0, 1)
            )
            OR CARDINALITY(player."voluntarilyRevealedCardIndices") <> (
              SELECT COUNT(DISTINCT value) FROM UNNEST(player."voluntarilyRevealedCardIndices") value
            )
        ELSE player."holeCardsPublic"
          OR player."voluntarilyRevealedAt" IS NOT NULL
          OR CARDINALITY(player."voluntarilyRevealedCardIndices") <> 0
      END
    `,
  },
  {
    code: "ROOM_CONFIGURATION",
    query: Prisma.sql`
      SELECT COUNT(*)::BIGINT AS count FROM "Room"
      WHERE "durationMinutes" NOT IN (30, 60, 90, 120, 150, 180)
        OR "actionTimeSeconds" NOT IN (10, 15, 20, 25, 30, 35, 40, 45)
        OR "paidCardRevealEnabled" IS DISTINCT FROM TRUE
        OR "paidCardRevealCost" <> 50
    `,
  },
  {
    code: "CLOSED_ROOM_ACTIVE_SEAT",
    query: Prisma.sql`
      SELECT COUNT(*)::BIGINT AS count FROM "Room" room
      JOIN "TableSeat" seat ON seat."roomId" = room."id"
      WHERE room."status" = 'CLOSED'::"RoomStatus"
    `,
  },
  {
    code: "ARCHIVED_ROOM_STATE",
    query: Prisma.sql`
      SELECT COUNT(*)::BIGINT AS count FROM "Room"
      WHERE "archivedAt" IS NOT NULL AND ("status" <> 'CLOSED'::"RoomStatus" OR "closedAt" IS NULL)
    `,
  },
  {
    code: "PAID_HAND_REVEAL_ACCOUNTING",
    query: Prisma.sql`
      SELECT COUNT(*)::BIGINT AS count FROM "PaidHandRevealPurchase" purchase
      JOIN "HandRecord" hand ON hand."id" = purchase."handId"
      JOIN "WalletLedgerEntry" ledger ON ledger."id" = purchase."walletLedgerEntryId"
      WHERE purchase."cost" <> hand."paidCardRevealCost"
        OR purchase."walletSignedAmount" <> -purchase."cost"
        OR purchase."walletType" <> 'PAID_CARD_REVEAL'::"WalletLedgerType"
        OR ledger."signedAmount" <> -purchase."cost"
        OR ledger."type" <> 'PAID_CARD_REVEAL'::"WalletLedgerType"
        OR ledger."relatedHandId" <> purchase."handId"
    `,
  },
  {
    code: "HYPOTHETICAL_RUNOUT_ACCOUNTING",
    query: Prisma.sql`
      SELECT COUNT(*)::BIGINT AS count FROM "HypotheticalRunoutPurchase" purchase
      JOIN "HandRecord" hand ON hand."id" = purchase."handId"
      JOIN "WalletLedgerEntry" ledger ON ledger."id" = purchase."walletLedgerEntryId"
      LEFT JOIN "HandHypotheticalRunout" runout ON runout."handId" = purchase."handId"
      WHERE runout."id" IS NULL
        OR purchase."cost" <> 10
        OR purchase."walletSignedAmount" <> -purchase."cost"
        OR purchase."walletType" <> 'HYPOTHETICAL_RUNOUT'::"WalletLedgerType"
        OR ledger."signedAmount" <> -purchase."cost"
        OR ledger."type" <> 'HYPOTHETICAL_RUNOUT'::"WalletLedgerType"
        OR ledger."relatedHandId" <> purchase."handId"
    `,
  },
  {
    code: "HYPOTHETICAL_RUNOUT_CARDS",
    query: Prisma.sql`
      SELECT COUNT(*)::BIGINT AS count FROM "HandHypotheticalRunout" runout
      JOIN "HandRecord" hand ON hand."id" = runout."handId"
      WHERE CARDINALITY(runout."cards") <> 5 - CARDINALITY(hand."board")
        OR CARDINALITY(runout."cards") <> (SELECT COUNT(DISTINCT card) FROM UNNEST(runout."cards") card)
        OR EXISTS (SELECT 1 FROM UNNEST(runout."cards") card WHERE card !~ '^[2-9TJQKA][cdhs]$')
        OR EXISTS (SELECT 1 FROM UNNEST(runout."cards") card WHERE card = ANY(hand."board"))
        OR EXISTS (
          SELECT 1 FROM "HandPlayerRecord" player, UNNEST(runout."cards") card
          WHERE player."handId" = hand."id" AND card = ANY(player."holeCards")
        )
    `,
  },
  {
    code: "ACTION_TIME_EXTENSION_ACCOUNTING",
    query: Prisma.sql`
      SELECT COUNT(*)::BIGINT AS count FROM "WalletLedgerEntry" ledger
      LEFT JOIN "HandRecord" hand ON hand."id" = ledger."relatedHandId"
      LEFT JOIN "Room" room ON room."id" = ledger."relatedRoomId"
      WHERE ledger."type" = 'ACTION_TIME_EXTENSION'::"WalletLedgerType"
        AND (
          hand."id" IS NULL OR room."id" IS NULL
          OR -ledger."signedAmount" <> 10
          OR ledger."metadata"->>'handId' IS DISTINCT FROM ledger."relatedHandId"
          OR CASE
            WHEN COALESCE(ledger."metadata"->>'addedSeconds', '') ~ '^[0-9]+(?:\\.5)?$'
              THEN (ledger."metadata"->>'addedSeconds')::NUMERIC <> room."actionTimeSeconds"::NUMERIC / 2
            ELSE TRUE
          END
        )
    `,
  },
  {
    code: "HAND_ENTRY_FEE_ACCOUNTING",
    query: Prisma.sql`
      SELECT COUNT(*)::BIGINT AS count FROM "WalletLedgerEntry" ledger
      LEFT JOIN "Room" room ON room."id" = ledger."relatedRoomId"
      LEFT JOIN "GameSession" session ON session."id" = ledger."relatedGameSessionId"
      LEFT JOIN "HandRecord" hand ON hand."id" = (ledger."metadata"->>'handId')
      LEFT JOIN "TableSnapshot" snapshot ON snapshot."roomId" = ledger."relatedRoomId"
      WHERE ledger."type" = 'HAND_ENTRY_FEE'::"WalletLedgerType"
        AND (
          ledger."signedAmount" <> -10
          OR ledger."balanceAfter" <> ledger."balanceBefore" - 10
          OR room."id" IS NULL
          OR session."id" IS NULL
          OR COALESCE((ledger."metadata"->>'handId'), '') = ''
          OR ledger."idempotencyKey" <> ('hand-entry:' || (ledger."metadata"->>'handId') || ':' || ledger."userId")
          OR (
            hand."id" IS NULL
            AND snapshot."activeHandId" IS DISTINCT FROM (ledger."metadata"->>'handId')
          )
          OR (
            hand."id" IS NOT NULL
            AND ledger."relatedHandId" IS DISTINCT FROM hand."id"
          )
        )
    `,
  },
  {
    code: "ACTION_TIME_EXTENSION_RECEIPT",
    query: Prisma.sql`
      SELECT COUNT(*)::BIGINT AS count FROM "WalletLedgerEntry" ledger
      LEFT JOIN "RequestIdempotency" receipt
        ON receipt."resourceId" = ledger."id"
        AND receipt."actorId" = ledger."userId"
        AND receipt."scope" = 'TABLE_ACTION_TIME_EXTENSION'::"IdempotencyScope"
      WHERE ledger."type" = 'ACTION_TIME_EXTENSION'::"WalletLedgerType"
        AND (
          receipt."id" IS NULL
          OR receipt."response"->>'turnDeadlineAt' IS NULL
          OR ledger."metadata"->>'previousDeadlineAt' IS NULL
        )
    `,
  },
  {
    code: "PREACTION_STATE",
    query: Prisma.sql`
      SELECT COUNT(*)::BIGINT AS count FROM "TableSeat"
      WHERE ("nextActionAutoCallCurrentBet" IS NOT NULL AND "nextActionAutoCallCurrentBet" < 0)
        OR ("nextActionAutopilotArmed" AND "nextActionAutoCallCurrentBet" IS NOT NULL)
        OR EXISTS (
          SELECT 1 FROM UNNEST("pendingShowCardIndices") value WHERE value NOT IN (0, 1)
        )
    `,
  },
  {
    code: "STALE_SELECTED_REVEAL",
    query: Prisma.sql`
      SELECT COUNT(*)::BIGINT AS count FROM "TableSeat" seat
      JOIN "TableSnapshot" snapshot ON snapshot."roomId" = seat."roomId"
      WHERE snapshot."activeHandId" IS NULL AND CARDINALITY(seat."pendingShowCardIndices") > 0
    `,
  },
  {
    code: "ACTION_RECEIPT_UNIQUENESS",
    query: Prisma.sql`
      SELECT COUNT(*)::BIGINT AS count FROM (
        SELECT "roomId", "userId", "clientActionId" FROM "TableActionReceipt"
        GROUP BY "roomId", "userId", "clientActionId" HAVING COUNT(*) <> 1
      ) violations
    `,
  },
];

export async function runDataAudit(database: DatabaseClient): Promise<DataAuditReport> {
  const checks = await Promise.all(SQL_CHECKS.map(async (check): Promise<DataAuditCheck> => {
    const rows = await database.$queryRaw<Array<{ readonly count: bigint | number }>>(check.query);
    const count = Number(rows[0]?.count ?? 0);
    return { code: check.code, count, status: count === 0 ? "PASS" : "FAIL" };
  }));

  const snapshots = await database.tableSnapshot.findMany({
    select: {
      payload: true,
      room: { select: { durationMinutes: true, expiresAt: true } },
    },
  });
  const invalidSnapshotCount = snapshots.reduce(
    (count, snapshot) => count + (TableSnapshotPayloadSchema.safeParse(
      normalizeTableSnapshotPayload(snapshot.payload, snapshot.room),
    ).success ? 0 : 1),
    0,
  );
  checks.push({
    code: "SNAPSHOT_SCHEMA",
    count: invalidSnapshotCount,
    status: invalidSnapshotCount === 0 ? "PASS" : "FAIL",
  });

  const failureCount = checks.filter((check) => check.status === "FAIL").length;
  return {
    checkedAt: new Date().toISOString(),
    checkCount: checks.length,
    checks,
    failureCount,
    ok: failureCount === 0,
  };
}
