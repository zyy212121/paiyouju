import { AVATAR_IDS, type AvatarId } from "@paiyouju/shared";
import { createHash, randomInt, randomUUID } from "node:crypto";

import type { Environment } from "../../config/environment.js";
import type { DatabaseClient } from "../../db/client.js";
import { ApiError } from "../../http/api-error.js";
import { hashPassword, verifyPassword } from "../../security/passwords.js";
import {
  createSessionToken,
  hashSessionToken,
  sessionExpiresAt,
} from "../../security/sessions.js";
import type { LoginInput, RegisterInput } from "./auth.schemas.js";

interface AuthServiceDependencies {
  readonly clock?: () => Date;
  readonly createAvatarId?: () => AvatarId;
  readonly createToken?: () => string;
  readonly createUsername?: () => string;
}

interface PublicUser {
  readonly avatarId: AvatarId;
  readonly createdAt: Date;
  readonly id: string;
  readonly nickname: string;
  readonly hasPhoneNumber: boolean;
  readonly phoneMasked: string | null;
  readonly role: "USER" | "ADMIN";
  readonly username: string;
  readonly walletBalance: number;
}

export interface AuthResult {
  readonly expiresAt: Date;
  readonly rawToken: string;
  readonly user: PublicUser;
}

function isPrismaCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function uniqueTarget(error: unknown): string {
  if (typeof error !== "object" || error === null || !("meta" in error)) {
    return "";
  }
  return JSON.stringify((error as { meta?: unknown }).meta);
}

function initialGrantFingerprint(userId: string, amount: number): string {
  return createHash("sha256")
    .update(JSON.stringify({ amount, type: "INITIAL_GRANT", userId }))
    .digest("hex");
}

function maskPhoneNumber(phoneNumber: string | null): string | null {
  return phoneNumber ? `${phoneNumber.slice(0, 3)}****${phoneNumber.slice(-4)}` : null;
}

export function createAuthService(
  database: DatabaseClient,
  environment: Environment,
  dependencies: AuthServiceDependencies = {},
) {
  const clock = dependencies.clock ?? (() => new Date());
  const tokenFactory = dependencies.createToken ?? createSessionToken;
  const avatarFactory = dependencies.createAvatarId ?? (() => AVATAR_IDS[randomInt(AVATAR_IDS.length)]!);
  const usernameFactory = dependencies.createUsername
    ?? (() => `u_${randomUUID().replaceAll("-", "").slice(0, 24)}`);
  const dummyHash = hashPassword(createSessionToken());

  async function createSession(userId: string) {
    const rawToken = tokenFactory();
    const now = clock();
    const expiresAt = sessionExpiresAt(now);
    await database.userSession.create({
      data: {
        expiresAt,
        lastSeenAt: now,
        tokenHash: hashSessionToken(rawToken),
        userId,
      },
    });
    return { expiresAt, rawToken };
  }

  return {
    async login(input: LoginInput): Promise<AuthResult> {
      const phoneLogin = /^1\d{10}$/u.test(input.identifier);
      const user = phoneLogin
        ? await database.user.findUnique({ include: { wallet: true }, where: { phoneNumber: input.identifier } })
        : environment.ALLOW_LEGACY_USERNAME_LOGIN
          ? await database.user.findUnique({ include: { wallet: true }, where: { usernameNormalized: input.identifier.toLowerCase() } })
          : null;
      const passwordMatches = await verifyPassword(
        user?.passwordHash ?? (await dummyHash),
        input.password,
      );
      if (!user || !user.wallet || !passwordMatches) {
        throw new ApiError(
          401,
          "AUTH_INVALID_CREDENTIALS",
          "登录信息或密码错误",
        );
      }

      try {
        const session = await createSession(user.id);
        return {
          ...session,
          user: {
            avatarId: user.avatarId as AvatarId,
            createdAt: user.createdAt,
            id: user.id,
            hasPhoneNumber: user.phoneNumber !== null,
            nickname: user.nickname,
            phoneMasked: maskPhoneNumber(user.phoneNumber),
            role: user.role,
            username: user.username,
            walletBalance: user.wallet.balance,
          },
        };
      } catch (error: unknown) {
        if (isPrismaCode(error, "P2002")) {
          throw new ApiError(409, "SESSION_TOKEN_COLLISION", "无法创建会话，请重试");
        }
        throw error;
      }
    },

    async register(input: RegisterInput): Promise<AuthResult> {
      const passwordHash = await hashPassword(input.password);
      const rawToken = tokenFactory();
      const now = clock();
      const expiresAt = sessionExpiresAt(now);
      const avatarId = avatarFactory();

      for (let attempt = 0; attempt < 3; attempt += 1) try {
        const username = usernameFactory();
        const usernameNormalized = username.toLowerCase();
        const user = await database.$transaction(async (transaction) => {
          const createdUser = await transaction.user.create({
            data: {
              avatarId,
              nickname: input.nickname,
              passwordHash,
              phoneNumber: input.phoneNumber,
              username,
              usernameNormalized,
            },
          });
          const wallet = await transaction.wallet.create({
            data: {
              balance: environment.INITIAL_USER_POINTS,
              userId: createdUser.id,
              version: 1,
            },
          });
          await transaction.walletLedgerEntry.create({
            data: {
              balanceAfter: environment.INITIAL_USER_POINTS,
              balanceBefore: 0,
              idempotencyKey: `initial-grant:${createdUser.id}`,
              requestFingerprint: initialGrantFingerprint(
                createdUser.id,
                environment.INITIAL_USER_POINTS,
              ),
              sequence: 1,
              signedAmount: environment.INITIAL_USER_POINTS,
              type: "INITIAL_GRANT",
              userId: createdUser.id,
              walletId: wallet.id,
            },
          });
          await transaction.userSession.create({
            data: {
              expiresAt,
              lastSeenAt: now,
              tokenHash: hashSessionToken(rawToken),
              userId: createdUser.id,
            },
          });
          return { createdUser, wallet };
        });

        return {
          expiresAt,
          rawToken,
          user: {
            avatarId: user.createdUser.avatarId as AvatarId,
            createdAt: user.createdUser.createdAt,
            hasPhoneNumber: true,
            id: user.createdUser.id,
            nickname: user.createdUser.nickname,
            phoneMasked: maskPhoneNumber(user.createdUser.phoneNumber),
            role: user.createdUser.role,
            username: user.createdUser.username,
            walletBalance: user.wallet.balance,
          },
        };
      } catch (error: unknown) {
        if (isPrismaCode(error, "P2002")) {
          const target = uniqueTarget(error);
          if (target.includes("phoneNumber")) {
            throw new ApiError(409, "PHONE_NUMBER_TAKEN", "该手机号已被使用");
          }
          if (target.includes("tokenHash")) {
            throw new ApiError(409, "SESSION_TOKEN_COLLISION", "无法创建会话，请重试");
          }
          if (target.includes("usernameNormalized")) continue;
        }
        throw error;
      }
      throw new ApiError(503, "INTERNAL_USERNAME_COLLISION", "暂时无法创建账户，请重试");
    },
  };
}
