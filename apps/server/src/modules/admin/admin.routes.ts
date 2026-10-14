import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import type { Environment } from "../../config/environment.js";
import { ApiError, success } from "../../http/api-error.js";
import { requireAdministrator } from "../../http/authentication.js";
import type { SessionService } from "../sessions/session.service.js";
import {
  AdminDestructiveActionSchema,
  AdminListQuerySchema,
  AdminRoomActionSchema,
  AdminTestBotLeaseClaimSchema,
  AdminTestBotLeaseSchema,
  AdminWalletAdjustmentSchema,
} from "./admin.schemas.js";
import type { AdminRequestContext, AdminService } from "./admin.service.js";

interface AdminRoutesDependencies {
  readonly admin: AdminService;
  readonly environment: Environment;
  readonly sessions: SessionService;
}

const UserParamsSchema = z.object({ userId: z.cuid() }).strict();
const RoomParamsSchema = z.object({ roomId: z.cuid() }).strict();
const GameParamsSchema = z.object({ gameSessionId: z.cuid() }).strict();
const HandParamsSchema = z.object({ handId: z.string().min(1).max(160) }).strict();

function summarizeIp(request: FastifyRequest): string | null {
  const value = request.ip.trim();
  return value.length === 0 ? null : value.slice(0, 128);
}

function summarizeUserAgent(request: FastifyRequest): string | null {
  const value = request.headers["user-agent"];
  if (typeof value !== "string") return null;
  const safe = value.replace(/[\p{Cc}<>]/gu, " ").trim();
  return safe.length === 0 ? null : safe.slice(0, 256);
}

export function registerAdminRoutes(
  app: FastifyInstance,
  dependencies: AdminRoutesDependencies,
): void {
  async function authenticate(request: FastifyRequest) {
    return requireAdministrator(
      request,
      dependencies.sessions,
      dependencies.environment.SESSION_COOKIE_NAME,
    );
  }

  function context(request: FastifyRequest, actorUserId: string): AdminRequestContext {
    return {
      actorUserId,
      ipAddressSummary: summarizeIp(request),
      requestId: request.id,
      userAgentSummary: summarizeUserAgent(request),
    };
  }

  app.get("/api/admin/dashboard", async (request) => {
    await authenticate(request);
    return success(await dependencies.admin.dashboard());
  });

  app.get("/api/admin/users", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request) => {
    await authenticate(request);
    const query = AdminListQuerySchema.parse(request.query);
    if (query.search && /^\d{11}$/u.test(query.search)) {
      throw new ApiError(400, "PHONE_SEARCH_REQUIRES_BODY", "完整手机号搜索必须通过安全请求体提交");
    }
    return success(await dependencies.admin.listUsers(query));
  });

  app.post("/api/admin/users/search", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request) => {
    await authenticate(request);
    return success(await dependencies.admin.listUsers(AdminListQuerySchema.parse(request.body)));
  });

  app.get("/api/admin/users/:userId", async (request) => {
    await authenticate(request);
    const { userId } = UserParamsSchema.parse(request.params);
    return success(await dependencies.admin.getUser(userId));
  });

  app.post("/api/admin/users/:userId/delete", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request) => {
    const identity = await authenticate(request);
    const { userId } = UserParamsSchema.parse(request.params);
    return success(await dependencies.admin.deleteUserData(
      userId,
      AdminDestructiveActionSchema.parse(request.body),
      context(request, identity.user.id),
    ));
  });

  app.get("/api/admin/rooms", async (request) => {
    await authenticate(request);
    return success(await dependencies.admin.listRooms(AdminListQuerySchema.parse(request.query)));
  });

  app.get("/api/admin/rooms/:roomId", async (request) => {
    await authenticate(request);
    const { roomId } = RoomParamsSchema.parse(request.params);
    return success(await dependencies.admin.getRoom(roomId));
  });

  app.post("/api/admin/rooms/:roomId/delete", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request) => {
    const identity = await authenticate(request);
    const { roomId } = RoomParamsSchema.parse(request.params);
    return success(await dependencies.admin.deleteRoomData(
      roomId,
      AdminDestructiveActionSchema.parse(request.body),
      context(request, identity.user.id),
    ));
  });

  app.post("/api/admin/test-bots/claim", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request) => {
    const identity = await authenticate(request);
    return success(await dependencies.admin.claimTestBots(
      AdminTestBotLeaseClaimSchema.parse(request.body),
      identity.user.id,
    ));
  });

  app.post("/api/admin/test-bots/heartbeat", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request) => {
    const identity = await authenticate(request);
    return success(await dependencies.admin.heartbeatTestBots(
      AdminTestBotLeaseSchema.parse(request.body),
      identity.user.id,
    ));
  });

  app.post("/api/admin/test-bots/release", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request) => {
    const identity = await authenticate(request);
    return success(await dependencies.admin.releaseTestBots(
      AdminTestBotLeaseSchema.parse(request.body),
      identity.user.id,
    ));
  });

  for (const [path, action] of [
    ["pause", "PAUSE"],
    ["resume", "RESUME"],
    ["close", "CLOSE"],
  ] as const) {
    app.post(`/api/admin/rooms/:roomId/${path}`, async (request) => {
      const identity = await authenticate(request);
      const { roomId } = RoomParamsSchema.parse(request.params);
      const input = AdminRoomActionSchema.parse(request.body);
      return success(await dependencies.admin.mutateRoom(
        roomId,
        action,
        input,
        context(request, identity.user.id),
      ));
    });
  }

  app.get("/api/admin/tables", async (request) => {
    await authenticate(request);
    return success(await dependencies.admin.listTables(AdminListQuerySchema.parse(request.query)));
  });

  app.get("/api/admin/games", async (request) => {
    await authenticate(request);
    return success(await dependencies.admin.listGames(AdminListQuerySchema.parse(request.query)));
  });

  app.get("/api/admin/games/:gameSessionId", async (request) => {
    await authenticate(request);
    const { gameSessionId } = GameParamsSchema.parse(request.params);
    return success(await dependencies.admin.getGame(gameSessionId));
  });

  app.get("/api/admin/hands", async (request) => {
    await authenticate(request);
    return success(await dependencies.admin.listHands(AdminListQuerySchema.parse(request.query)));
  });

  app.get("/api/admin/hands/:handId", async (request) => {
    const identity = await authenticate(request);
    const { handId } = HandParamsSchema.parse(request.params);
    return success(await dependencies.admin.getHand(handId, context(request, identity.user.id)));
  });

  app.get("/api/admin/wallet-ledger", async (request) => {
    await authenticate(request);
    return success(await dependencies.admin.listWalletLedger(AdminListQuerySchema.parse(request.query)));
  });

  app.get("/api/admin/point-actions", async (request) => {
    await authenticate(request);
    return success(await dependencies.admin.listPointActions(AdminListQuerySchema.parse(request.query)));
  });

  app.get("/api/admin/paid-reveals", async (request) => {
    await authenticate(request);
    return success(await dependencies.admin.listPaidReveals(AdminListQuerySchema.parse(request.query)));
  });

  app.get("/api/admin/hypothetical-runouts", async (request) => {
    await authenticate(request);
    return success(await dependencies.admin.listHypotheticalRunouts(AdminListQuerySchema.parse(request.query)));
  });

  app.get("/api/admin/audit-logs", async (request) => {
    await authenticate(request);
    return success(await dependencies.admin.listAuditLogs(AdminListQuerySchema.parse(request.query)));
  });

  app.get("/api/admin/recovery", async (request) => {
    await authenticate(request);
    return success(await dependencies.admin.listRecovery(AdminListQuerySchema.parse(request.query)));
  });

  for (const action of ["revalidate", "retry"] as const) {
    app.post(`/api/admin/recovery/:roomId/${action}`, { config: { rateLimit: { max: action === "retry" ? 5 : 20, timeWindow: "1 minute" } } }, async (request) => {
      const identity = await authenticate(request);
      const { roomId } = RoomParamsSchema.parse(request.params);
      const input = AdminRoomActionSchema.parse(request.body);
      const result = action === "revalidate"
        ? await dependencies.admin.revalidateRecovery(roomId, input, context(request, identity.user.id))
        : await dependencies.admin.retryRecovery(roomId, input, context(request, identity.user.id));
      return success(result);
    });
  }

  app.get("/api/admin/system", async (request) => {
    await authenticate(request);
    return success(await dependencies.admin.system());
  });

  app.post("/api/admin/users/:userId/wallet-adjustments", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request) => {
    const identity = await authenticate(request);
    const { userId } = UserParamsSchema.parse(request.params);
    const input = AdminWalletAdjustmentSchema.parse(request.body);
    return success(await dependencies.admin.adjustWallet(userId, input, context(request, identity.user.id)));
  });
}
