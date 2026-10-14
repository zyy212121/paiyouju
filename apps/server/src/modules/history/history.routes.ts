import {
  GameHistoryQuerySchema,
  HandHistoryQuerySchema,
  HandRunoutQuerySchema,
  HypotheticalRunoutInputSchema,
  PaidCardRevealInputSchema,
  PaidHandRevealInputSchema,
} from "@paiyouju/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { Environment } from "../../config/environment.js";
import { success } from "../../http/api-error.js";
import { requireAuthentication } from "../../http/authentication.js";
import type { SessionService } from "../sessions/session.service.js";
import type { HistoryService } from "./history.service.js";
import type { PaidCardRevealService } from "./paid-card-reveal.service.js";
import type { PaidHandRevealService } from "./paid-hand-reveal.service.js";
import type { HypotheticalRunoutService } from "./hypothetical-runout.service.js";

const GameParamsSchema = z.object({ gameSessionId: z.string().min(1).max(64) }).strict();
const HandParamsSchema = z.object({ handId: z.string().uuid() }).strict();

interface HistoryRoutesDependencies {
  readonly environment: Environment;
  readonly history: HistoryService;
  readonly hypotheticalRunouts: HypotheticalRunoutService;
  readonly paidReveals: PaidCardRevealService;
  readonly paidHandReveals: PaidHandRevealService;
  readonly sessions: SessionService;
}

export function registerHistoryRoutes(app: FastifyInstance, dependencies: HistoryRoutesDependencies): void {
  const identity = (request: Parameters<typeof requireAuthentication>[0]) => requireAuthentication(
    request,
    dependencies.sessions,
    dependencies.environment.SESSION_COOKIE_NAME,
  );

  app.get("/api/games", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request) => {
    const authenticated = await identity(request);
    return success(await dependencies.history.listGames(authenticated.user.id, GameHistoryQuerySchema.parse(request.query)));
  });

  app.get("/api/games/:gameSessionId", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request) => {
    const authenticated = await identity(request);
    const { gameSessionId } = GameParamsSchema.parse(request.params);
    return success(await dependencies.history.getGame(authenticated.user.id, gameSessionId));
  });

  app.get("/api/hands", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request) => {
    const authenticated = await identity(request);
    return success(await dependencies.history.listHands(authenticated.user.id, HandHistoryQuerySchema.parse(request.query)));
  });

  app.get("/api/hands/:handId", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request) => {
    const authenticated = await identity(request);
    const { handId } = HandParamsSchema.parse(request.params);
    const { runoutIndex = null } = HandRunoutQuerySchema.parse(request.query);
    return success(await dependencies.history.getHand(authenticated.user.id, handId, runoutIndex));
  });

  app.get("/api/hands/:handId/replay", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request) => {
    const authenticated = await identity(request);
    const { handId } = HandParamsSchema.parse(request.params);
    return success(await dependencies.history.getReplay(authenticated.user.id, handId));
  });

  app.post(
    "/api/hands/:handId/paid-reveals",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const authenticated = await identity(request);
      const { handId } = HandParamsSchema.parse(request.params);
      const result = await dependencies.paidReveals.purchase(authenticated.user.id, handId, PaidCardRevealInputSchema.parse(request.body));
      return reply.code(result.alreadyOwned ? 200 : 201).send(success(result));
    },
  );

  app.post(
    "/api/hands/:handId/paid-hand-reveal",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const authenticated = await identity(request);
      const { handId } = HandParamsSchema.parse(request.params);
      const result = await dependencies.paidHandReveals.purchase(authenticated.user.id, handId, PaidHandRevealInputSchema.parse(request.body));
      return reply.code(result.alreadyOwned ? 200 : 201).send(success(result));
    },
  );

  app.post(
    "/api/hands/:handId/hypothetical-runout",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const authenticated = await identity(request);
      const { handId } = HandParamsSchema.parse(request.params);
      const result = await dependencies.hypotheticalRunouts.generate(authenticated.user.id, handId, HypotheticalRunoutInputSchema.parse(request.body));
      return reply.code(201).send(success(result));
    },
  );
}
