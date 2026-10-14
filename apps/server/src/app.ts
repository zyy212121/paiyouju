import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { PRODUCT_NAME, type HealthResponse, type ProfileUpdateInput } from "@paiyouju/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import type { Environment } from "./config/environment.js";
import type { DatabaseClient } from "./db/client.js";
import { installErrorHandler } from "./http/error-handler.js";
import { installOriginGuard } from "./http/origin-guard.js";
import { registerAuthRoutes } from "./modules/auth/auth.routes.js";
import { createAuthService } from "./modules/auth/auth.service.js";
import { registerAccountRoutes } from "./modules/account/account.routes.js";
import { createPhoneBindingService } from "./modules/account/phone-binding.service.js";
import { registerHistoryRoutes } from "./modules/history/history.routes.js";
import { createHistoryService } from "./modules/history/history.service.js";
import { createPaidCardRevealService } from "./modules/history/paid-card-reveal.service.js";
import { createPaidHandRevealService } from "./modules/history/paid-hand-reveal.service.js";
import { createHypotheticalRunoutService } from "./modules/history/hypothetical-runout.service.js";
import { registerProfileRoutes } from "./modules/profile/profile.routes.js";
import { createProfileService } from "./modules/profile/profile.service.js";
import { registerRoomRoutes } from "./modules/rooms/room.routes.js";
import { createRoomService } from "./modules/rooms/room.service.js";
import { createSessionService } from "./modules/sessions/session.service.js";
import { registerWalletRoutes } from "./modules/wallet/wallet.routes.js";
import { createWalletService } from "./modules/wallet/wallet.service.js";
import { registerAdminRoutes } from "./modules/admin/admin.routes.js";
import { createAdminService } from "./modules/admin/admin.service.js";
import type { TableRuntimeManager } from "./modules/tables/runtime/table-runtime-manager.js";
import type { Readiness } from "./modules/health/readiness.js";
import type { Prisma, RoomStatus } from "./generated/prisma/client.js";

export interface RoomLifecycleMutation {
  readonly actionTimeSeconds: number;
  readonly bigBlind: number;
  readonly bombPotBlindMultiplier: number | null;
  readonly bombPotIntervalMinutes: number | null;
  readonly bombPotNextAt: Date | null;
  readonly durationMinutes: number;
  readonly expiresAt: Date;
  readonly initialBuyIn: number;
  readonly maximumBuyIn: number;
  readonly maxSeats: number;
  readonly minimumBuyIn: number;
  readonly name: string;
  readonly nextHandPaused: boolean;
  readonly ownerId: string;
  readonly paidCardRevealCost: number;
  readonly paidCardRevealEnabled: boolean;
  readonly roomCode: string;
  readonly requiresManualStart: boolean;
  readonly runItTwiceEnabled: boolean;
  readonly id: string;
  readonly smallBlind: number;
  readonly specialMode: "NORMAL" | "SQUID" | "SHORT_DECK" | "BOMB_POT";
  readonly status: RoomStatus;
  readonly squidRoundGraceEndsAt: Date | null;
  readonly squidRoundNumber: number;
  readonly squidSettlementPending: boolean;
  readonly squidStake: number | null;
  readonly tableStartedAt: Date | null;
}

export interface BuildAppOptions {
  readonly activeSockets?: () => number;
  readonly database?: DatabaseClient;
  readonly environment?: Environment;
  readonly eventLoopDelay?: () => {
    readonly maximumMs: number;
    readonly meanMs: number;
    readonly p50Ms: number;
    readonly p95Ms: number;
    readonly p99Ms: number;
  };
  readonly logger?:
    | boolean
    | {
        readonly level?: string;
        readonly stream?: NodeJS.WritableStream;
      };
  readonly rateLimit?: boolean;
  readonly readiness?: Readiness;
  readonly onSessionRevoked?: (sessionId: string) => void | Promise<void>;
  readonly onRecoveryRetry?: (roomId: string) => Promise<unknown>;
  readonly onRoomUpdating?: (
    roomId: string,
    action: "CLOSE" | "PAUSE" | "RESUME",
    room: RoomLifecycleMutation,
    transaction: Prisma.TransactionClient,
    administrator: boolean,
  ) => void | Promise<void>;
  readonly runRoomMutation?: <T>(roomId: string, mutation: () => Promise<T>) => Promise<T>;
  readonly roomCode?: () => string;
  readonly runtimes?: TableRuntimeManager;
  readonly serveStatic?: boolean;
  readonly webRoot?: string;
}

const defaultWebRoot = fileURLToPath(new URL("../../web/dist", import.meta.url));

export async function buildApp(
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: 64 * 1_024,
    genReqId: () => randomUUID(),
    logger:
      options.logger === true || typeof options.logger === "object"
        ? {
            redact: {
              paths: [
                "req.headers.authorization",
                "req.headers.cookie",
                "res.headers.set-cookie",
                "password",
                "passwordHash",
                "phoneNumber",
                "identifier",
                "req.body.phoneNumber",
                "req.body.identifier",
                "req.body.currentPassword",
                "req.body.password",
                "req.body.search",
                "rawToken",
                "tokenHash",
              ],
              censor: "[REDACTED]",
            },
            ...(typeof options.logger === "object" && options.logger.level
              ? { level: options.logger.level }
              : {}),
            ...(typeof options.logger === "object"
              && options.logger.stream
              ? { stream: options.logger.stream }
              : {}),
          }
        : false,
  });

  await app.register(fastifyCookie);
  app.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", request.id);
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    reply.header("x-frame-options", "DENY");
    if (options.environment?.NODE_ENV === "production") {
      reply.header(
        "content-security-policy",
        "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:; media-src 'self' blob:; worker-src 'self' blob:; manifest-src 'self'",
      );
      if (options.environment.CLIENT_ORIGIN.startsWith("https://")) {
        reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
      }
    }
    if (request.url.startsWith("/api/")) {
      reply.header("cache-control", "no-store, max-age=0");
      reply.header("pragma", "no-cache");
    }
  });

  if (options.environment) {
    await app.register(fastifyCors, {
      allowedHeaders: ["Accept", "Content-Type", "Idempotency-Key", "X-Wepoker-Request"],
      credentials: true,
      origin: (origin, callback) => {
        callback(null, origin === options.environment?.CLIENT_ORIGIN);
      },
    });
    installOriginGuard(app, options.environment.CLIENT_ORIGIN);
  }

  if (options.rateLimit !== false) {
    await app.register(fastifyRateLimit, { global: false });
  }

  installErrorHandler(app, options.environment);

  app.get<{ Reply: HealthResponse }>("/health", async () => ({
    status: "ok",
    service: `${PRODUCT_NAME} server`,
  }));

  app.get("/ready", async (_request, reply) => {
    if (!options.readiness) {
      return reply.code(503).send({
        activeRuntimes: 0,
        database: "unavailable",
        degradedRooms: 0,
        recoveryComplete: false,
        status: "starting",
        timestamp: new Date().toISOString(),
      });
    }
    const readiness = await options.readiness.snapshot();
    return reply.code(readiness.status === "ready" ? 200 : 503).send(readiness);
  });

  if (options.database && options.environment) {
    const sessions = createSessionService(options.database);
    const auth = createAuthService(options.database, options.environment);
    const phoneBinding = createPhoneBindingService(options.database);
    const wallet = createWalletService(options.database);
    const history = createHistoryService(options.database);
    const paidReveals = createPaidCardRevealService(options.database);
    const paidHandReveals = createPaidHandRevealService(options.database);
    const hypotheticalRunouts = createHypotheticalRunoutService(options.database);
    const profile = createProfileService(options.database, history, {
      ...(options.runtimes === undefined ? {} : {
        onProfileChanged: async (userId: string, input: ProfileUpdateInput) => {
          const affectedRooms = (await Promise.all(options.runtimes!.entries().map(async ([roomId, runtime]) =>
            runtime.queue.run(() => {
              let changed = false;
              for (const [seatIndex, seat] of runtime.seats) {
                if (seat.userId !== userId) continue;
                const next = {
                  ...seat,
                  ...(input.avatarId === undefined ? {} : { avatarId: input.avatarId }),
                  ...(input.nickname === undefined ? {} : { nickname: input.nickname }),
                };
                if (next.avatarId === seat.avatarId && next.nickname === seat.nickname) continue;
                runtime.seats.set(seatIndex, next);
                changed = true;
              }
              if (changed) runtime.markPresentationChanged();
              return changed ? roomId : null;
            }),
          ))).filter((roomId): roomId is string => roomId !== null);
          await Promise.all(affectedRooms.map(async (roomId) => {
            try {
              await options.runtimes!.notify(roomId);
            } catch {
              app.log.warn({ roomId, userId }, "profile projection refresh failed");
            }
          }));
        },
      }),
    });
    const rooms = createRoomService(options.database, {
      ...(options.runtimes === undefined ? {} : { onRoomChanged: (roomId: string) => options.runtimes!.notify(roomId) }),
      ...(options.onRoomUpdating === undefined ? {} : { onRoomUpdating: options.onRoomUpdating }),
      ...(options.runRoomMutation === undefined ? {} : { runRoomMutation: options.runRoomMutation }),
      ...(options.roomCode === undefined ? {} : { roomCode: options.roomCode }),
    });
    const admin = createAdminService(options.database, {
      ...(options.activeSockets === undefined ? {} : { activeSockets: options.activeSockets }),
      applicationVersion: options.environment.APP_VERSION,
      ...(options.eventLoopDelay === undefined ? {} : { eventLoopDelay: options.eventLoopDelay }),
      ...(options.onRecoveryRetry === undefined ? {} : { retryRecovery: options.onRecoveryRetry }),
      roomLifecycleAction: rooms.mutateRoomAsAdministrator,
      ...(options.runtimes === undefined
        ? {}
        : {
            runtimeSummary: () => ({
              actionCacheSize: options.runtimes!.entries().reduce((total, [, runtime]) => total + runtime.actionCache.size, 0),
              activeRuntimes: options.runtimes!.size,
              activeRuntimeTimers: options.runtimes!.entries().filter(([, runtime]) => runtime.hasTransientTimer()).length,
              degradedRooms: options.runtimes!.entries().filter(([, runtime]) => runtime.status === "RECOVERY_ERROR").length,
              recoveryComplete: true,
            }),
            removeClosedRuntime: (roomId: string) => options.runtimes!.removeClosed(roomId),
          }),
    });
    registerAuthRoutes(app, {
      environment: options.environment,
      login: auth.login,
      register: auth.register,
      sessions,
      ...(options.onSessionRevoked === undefined ? {} : { onSessionRevoked: options.onSessionRevoked }),
    });
    registerAccountRoutes(app, {
      environment: options.environment,
      phoneBinding,
      sessions,
    });
    registerWalletRoutes(app, {
      environment: options.environment,
      sessions,
      wallet,
    });
    registerHistoryRoutes(app, {
      environment: options.environment,
      history,
      hypotheticalRunouts,
      paidHandReveals,
      paidReveals,
      sessions,
    });
    registerProfileRoutes(app, {
      environment: options.environment,
      profile,
      sessions,
    });
    registerRoomRoutes(app, {
      environment: options.environment,
      rooms,
      sessions,
    });
    registerAdminRoutes(app, {
      admin,
      environment: options.environment,
      sessions,
    });
  }

  if (options.serveStatic === true) {
    await app.register(fastifyStatic, {
      root: options.webRoot ?? defaultWebRoot,
      wildcard: false,
    });

  }

  app.setNotFoundHandler(async (request, reply) => {
    const acceptsHtml = request.headers.accept?.includes("text/html") ?? false;
    if (
      options.serveStatic === true &&
      request.method === "GET" &&
      acceptsHtml &&
      !request.url.startsWith("/api/")
    ) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({
      error: {
        code: "NOT_FOUND",
        message: "请求的资源不存在",
        requestId: request.id,
      },
    });
  });

  return app;
}
