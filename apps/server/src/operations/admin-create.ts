import { createHash, randomUUID } from "node:crypto";

import { MAX_POINTS } from "../config/environment.js";
import type { DatabaseClient } from "../db/client.js";
import { RegisterInputSchema, type RegisterInput } from "../modules/auth/auth.schemas.js";
import { hashPassword, verifyPassword } from "../security/passwords.js";

interface CreateAdministratorOptions {
  readonly username?: () => string;
}

export interface CreateAdministratorResult {
  readonly alreadyExists: boolean;
  readonly phoneMasked: string;
  readonly userId: string;
  readonly username: string;
}

function initialGrantFingerprint(userId: string, amount: number): string {
  return createHash("sha256")
    .update(JSON.stringify({ amount, type: "INITIAL_GRANT", userId }))
    .digest("hex");
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { readonly code?: unknown }).code === "P2002";
}

function mask(phoneNumber: string): string {
  return `${phoneNumber.slice(0, 3)}****${phoneNumber.slice(-4)}`;
}

async function existingAdministrator(
  database: DatabaseClient,
  input: RegisterInput,
): Promise<CreateAdministratorResult | null> {
  const existing = await database.user.findUnique({
    include: { wallet: true },
    where: { phoneNumber: input.phoneNumber },
  });
  if (!existing) return null;
  const identical = existing.role === "ADMIN"
    && existing.nickname === input.nickname
    && existing.wallet !== null
    && await verifyPassword(existing.passwordHash, input.password);
  if (!identical) {
    throw new Error("手机号已存在，但管理员信息不匹配；未做任何修改");
  }
  return {
    alreadyExists: true,
    phoneMasked: mask(input.phoneNumber),
    userId: existing.id,
    username: existing.username,
  };
}

export async function createAdministrator(
  database: DatabaseClient,
  rawInput: RegisterInput,
  initialPoints: number,
  options: CreateAdministratorOptions = {},
): Promise<CreateAdministratorResult> {
  const input = RegisterInputSchema.parse(rawInput);
  if (!Number.isSafeInteger(initialPoints) || initialPoints < 1 || initialPoints > MAX_POINTS) {
    throw new Error("INITIAL_USER_POINTS 超出安全范围");
  }
  const existing = await existingAdministrator(database, input);
  if (existing) return existing;

  const passwordHash = await hashPassword(input.password);
  const usernameFactory = options.username
    ?? (() => `u_${randomUUID().replaceAll("-", "").slice(0, 24)}`);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const username = usernameFactory();
    if (!/^[A-Za-z0-9_]{3,32}$/u.test(username)) throw new Error("内部用户名生成器返回无效值");
    try {
      const user = await database.$transaction(async (transaction) => {
        const created = await transaction.user.create({
          data: {
            nickname: input.nickname,
            passwordHash,
            phoneNumber: input.phoneNumber,
            role: "ADMIN",
            username,
            usernameNormalized: username.toLowerCase(),
          },
        });
        const wallet = await transaction.wallet.create({
          data: { balance: initialPoints, userId: created.id, version: 1 },
        });
        await transaction.walletLedgerEntry.create({
          data: {
            balanceAfter: initialPoints,
            balanceBefore: 0,
            idempotencyKey: `initial-grant:${created.id}`,
            requestFingerprint: initialGrantFingerprint(created.id, initialPoints),
            sequence: 1,
            signedAmount: initialPoints,
            type: "INITIAL_GRANT",
            userId: created.id,
            walletId: wallet.id,
          },
        });
        return created;
      });
      return {
        alreadyExists: false,
        phoneMasked: mask(input.phoneNumber),
        userId: user.id,
        username: user.username,
      };
    } catch (error: unknown) {
      if (!isUniqueViolation(error)) throw error;
      const concurrent = await existingAdministrator(database, input);
      if (concurrent) return concurrent;
    }
  }
  throw new Error("管理员账户创建冲突，请安全重试");
}
