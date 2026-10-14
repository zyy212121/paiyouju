import type { AvatarId } from "@paiyouju/shared";

import type { DatabaseClient } from "../../db/client.js";
import { hashSessionToken } from "../../security/sessions.js";

const LAST_SEEN_WRITE_INTERVAL_MS = 60 * 60 * 1_000;

export interface AuthenticatedIdentity {
  readonly sessionId: string;
  readonly user: {
    readonly avatarId: AvatarId;
    readonly createdAt: Date;
    readonly id: string;
    readonly hasPhoneNumber: boolean;
    readonly nickname: string;
    readonly phoneMasked: string | null;
    readonly role: "USER" | "ADMIN";
    readonly username: string;
    readonly walletBalance: number;
  };
}

export interface SessionService {
  authenticate(rawToken: string | undefined): Promise<AuthenticatedIdentity | null>;
  getSessionExpiry(sessionId: string): Promise<Date | null>;
  isSessionActive(sessionId: string): Promise<boolean>;
  revoke(rawToken: string | undefined): Promise<void>;
}

export function createSessionService(
  database: DatabaseClient,
  clock: () => Date = () => new Date(),
): SessionService {
  return {
    async authenticate(rawToken) {
      if (!rawToken) {
        return null;
      }

      const now = clock();
      const session = await database.userSession.findUnique({
        include: { user: { include: { wallet: true } } },
        where: { tokenHash: hashSessionToken(rawToken) },
      });
      if (
        !session ||
        session.revokedAt !== null ||
        session.expiresAt.getTime() <= now.getTime() ||
        !session.user.wallet
      ) {
        return null;
      }

      if (
        session.lastSeenAt === null ||
        now.getTime() - session.lastSeenAt.getTime() >= LAST_SEEN_WRITE_INTERVAL_MS
      ) {
        await database.userSession.updateMany({
          data: { lastSeenAt: now },
          where: { id: session.id, revokedAt: null },
        });
      }

      return {
        sessionId: session.id,
        user: {
          avatarId: session.user.avatarId as AvatarId,
          createdAt: session.user.createdAt,
          id: session.user.id,
          hasPhoneNumber: session.user.phoneNumber !== null,
          nickname: session.user.nickname,
          phoneMasked: session.user.phoneNumber
            ? `${session.user.phoneNumber.slice(0, 3)}****${session.user.phoneNumber.slice(-4)}`
            : null,
          role: session.user.role,
          username: session.user.username,
          walletBalance: session.user.wallet.balance,
        },
      };
    },

    async isSessionActive(sessionId) {
      const session = await database.userSession.findUnique({
        select: { expiresAt: true, revokedAt: true },
        where: { id: sessionId },
      });
      return session !== null
        && session.revokedAt === null
        && session.expiresAt.getTime() > clock().getTime();
    },

    async getSessionExpiry(sessionId) {
      const session = await database.userSession.findUnique({
        select: { expiresAt: true, revokedAt: true },
        where: { id: sessionId },
      });
      return session?.revokedAt === null ? session.expiresAt : null;
    },

    async revoke(rawToken) {
      if (!rawToken) {
        return;
      }
      await database.userSession.updateMany({
        data: { revokedAt: clock() },
        where: {
          revokedAt: null,
          tokenHash: hashSessionToken(rawToken),
        },
      });
    },
  };
}
