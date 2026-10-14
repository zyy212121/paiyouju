import { BindPhoneInputSchema, PhoneBindingResultSchema, type BindPhoneInput, type PhoneBindingResult } from "@paiyouju/shared";
import { createHash } from "node:crypto";

import type { DatabaseClient } from "../../db/client.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { ApiError } from "../../http/api-error.js";
import { verifyPassword } from "../../security/passwords.js";

function requestFingerprint(userId: string, input: BindPhoneInput): string {
  return createHash("sha256").update(JSON.stringify({
    currentPasswordHash: createHash("sha256").update(input.currentPassword).digest("hex"),
    operationId: input.operationId,
    phoneNumber: input.phoneNumber,
    userId,
  })).digest("hex");
}

function parseStored(value: Prisma.JsonValue | null): PhoneBindingResult | null {
  const parsed = PhoneBindingResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { readonly code?: unknown }).code === "P2002";
}

export function createPhoneBindingService(database: DatabaseClient) {
  return {
    async bind(userId: string, rawInput: BindPhoneInput): Promise<PhoneBindingResult> {
      const input = BindPhoneInputSchema.parse(rawInput);
      const fingerprint = requestFingerprint(userId, input);
      const existing = await database.requestIdempotency.findUnique({
        where: { scope_actorId_key: { actorId: userId, key: input.operationId, scope: "PHONE_BIND" } },
      });
      if (existing) {
        if (existing.requestHash !== fingerprint) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "操作 ID 已用于其他请求");
        const stored = parseStored(existing.response);
        if (!stored) throw new ApiError(409, "IDEMPOTENCY_IN_PROGRESS", "操作正在处理中");
        return stored;
      }
      try {
        return await database.$transaction(async (transaction) => {
          await transaction.$queryRaw<Array<{ readonly id: string }>>`
            SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE
          `;
          const replay = await transaction.requestIdempotency.findUnique({
            where: { scope_actorId_key: { actorId: userId, key: input.operationId, scope: "PHONE_BIND" } },
          });
          if (replay) {
            if (replay.requestHash !== fingerprint) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "操作 ID 已用于其他请求");
            const stored = parseStored(replay.response);
            if (!stored) throw new ApiError(409, "IDEMPOTENCY_IN_PROGRESS", "操作正在处理中");
            return stored;
          }
          const user = await transaction.user.findUnique({ where: { id: userId } });
          if (!user) throw new ApiError(404, "PROFILE_NOT_FOUND", "账户不存在");
          if (!await verifyPassword(user.passwordHash, input.currentPassword)) {
            throw new ApiError(401, "AUTH_INVALID_CREDENTIALS", "当前密码错误");
          }
          if (user.phoneNumber && user.phoneNumber !== input.phoneNumber) {
            throw new ApiError(409, "PHONE_ALREADY_BOUND", "手机号已绑定，普通用户不能更换");
          }
          if (!user.phoneNumber) {
            await transaction.user.update({ data: { phoneNumber: input.phoneNumber }, where: { id: userId } });
          }
          const result = PhoneBindingResultSchema.parse({
            alreadyBound: user.phoneNumber === input.phoneNumber,
            hasPhoneNumber: true,
            operationId: input.operationId,
            phoneMasked: `${input.phoneNumber.slice(0, 3)}****${input.phoneNumber.slice(-4)}`,
          });
          await transaction.requestIdempotency.create({
            data: {
              actorId: userId,
              key: input.operationId,
              requestHash: fingerprint,
              resourceId: userId,
              response: result as unknown as Prisma.InputJsonValue,
              scope: "PHONE_BIND",
            },
          });
          return result;
        });
      } catch (error: unknown) {
        if (isUniqueViolation(error)) throw new ApiError(409, "PHONE_NUMBER_TAKEN", "该手机号已被使用");
        throw error;
      }
    },
  };
}

export type PhoneBindingService = ReturnType<typeof createPhoneBindingService>;
