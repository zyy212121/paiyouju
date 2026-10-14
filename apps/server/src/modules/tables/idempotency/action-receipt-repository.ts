import { ActionCommandResultSchema, type ActionCommandResult } from "@paiyouju/shared";

import type { DatabaseClient } from "../../../db/client.js";
import type { HandActionType, Prisma } from "../../../generated/prisma/client.js";
import { ApiError } from "../../../http/api-error.js";

type ReceiptClient = DatabaseClient | Prisma.TransactionClient;

function parseResult(payload: Prisma.JsonValue): ActionCommandResult {
  const parsed = ActionCommandResultSchema.safeParse(payload);
  if (!parsed.success) throw new ApiError(500, "PERSISTENCE_ERROR", "行动回执数据损坏");
  return parsed.data;
}

export function createActionReceiptRepository(database: DatabaseClient) {
  return {
    async replayOrConflict(
      input: { readonly clientActionId: string; readonly fingerprint: string; readonly roomId: string; readonly userId: string },
      client: ReceiptClient = database,
    ): Promise<ActionCommandResult | null> {
      const existing = await client.tableActionReceipt.findUnique({
        where: { roomId_userId_clientActionId: { clientActionId: input.clientActionId, roomId: input.roomId, userId: input.userId } },
      });
      if (!existing) return null;
      if (existing.requestFingerprint !== input.fingerprint) {
        throw new ApiError(409, "ACTION_IDEMPOTENCY_CONFLICT", "行动 ID 已用于其他请求");
      }
      return { ...parseResult(existing.resultPayload), alreadyProcessed: true };
    },

    async create(
      input: {
        readonly actionType: HandActionType;
        readonly clientActionId: string;
        readonly fingerprint: string;
        readonly handId: string;
        readonly result: ActionCommandResult;
        readonly roomId: string;
        readonly userId: string;
      },
      client: ReceiptClient = database,
    ) {
      return client.tableActionReceipt.create({
        data: {
          actionType: input.actionType,
          clientActionId: input.clientActionId,
          handId: input.handId,
          requestFingerprint: input.fingerprint,
          resultCode: "APPLIED",
          resultPayload: input.result as unknown as Prisma.InputJsonValue,
          resultingStateVersion: input.result.stateVersion,
          roomId: input.roomId,
          userId: input.userId,
        },
      });
    },
  };
}
