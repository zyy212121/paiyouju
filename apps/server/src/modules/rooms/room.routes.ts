import type { FastifyInstance } from "fastify";
import { ArchiveRoomInputSchema, ClosedRoomsQuerySchema } from "@paiyouju/shared";

import type { Environment } from "../../config/environment.js";
import { ApiError, success } from "../../http/api-error.js";
import { requireAuthentication } from "../../http/authentication.js";
import type { SessionService } from "../sessions/session.service.js";
import type { createRoomService } from "./room.service.js";
import { CreateRoomInputSchema, IdempotencyKeySchema, JoinRoomInputSchema, RoomIdParamsSchema } from "./room.schemas.js";

interface RoomRoutesDependencies {
  readonly environment: Environment;
  readonly rooms: ReturnType<typeof createRoomService>;
  readonly sessions: SessionService;
}

export function registerRoomRoutes(app: FastifyInstance, dependencies: RoomRoutesDependencies): void {
  const identity = (request: Parameters<typeof requireAuthentication>[0]) =>
    requireAuthentication(request, dependencies.sessions, dependencies.environment.SESSION_COOKIE_NAME);

  app.post("/api/rooms", async (request, reply) => {
    const user = await identity(request);
    const header = request.headers["idempotency-key"];
    if (typeof header !== "string") {
      throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "需要 Idempotency-Key");
    }
    const result = await dependencies.rooms.createRoom(user.user.id, CreateRoomInputSchema.parse(request.body), IdempotencyKeySchema.parse(header));
    return reply.code(201).send(success(result));
  });

  app.post(
    "/api/rooms/join",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request) => {
      const user = await identity(request);
      return success(await dependencies.rooms.joinRoom(user.user.id, JoinRoomInputSchema.parse(request.body)));
    },
  );

  app.get("/api/rooms", async (request) => {
    const user = await identity(request);
    return success(await dependencies.rooms.listRooms(user.user.id));
  });

  app.get("/api/rooms/closed", async (request) => {
    const user = await identity(request);
    return success(await dependencies.rooms.listClosedRooms(user.user.id, ClosedRoomsQuerySchema.parse(request.query)));
  });

  app.get("/api/rooms/:roomId", async (request) => {
    const user = await identity(request);
    const { roomId } = RoomIdParamsSchema.parse(request.params);
    return success(await dependencies.rooms.getRoom(user.user.id, roomId));
  });

  app.get("/api/rooms/:roomId/rankings", async (request) => {
    const user = await identity(request);
    const { roomId } = RoomIdParamsSchema.parse(request.params);
    return success(await dependencies.rooms.getRankings(user.user.id, roomId));
  });

  app.post("/api/rooms/:roomId/archive", async (request) => {
    const user = await identity(request);
    const { roomId } = RoomIdParamsSchema.parse(request.params);
    return success(await dependencies.rooms.archiveRoom(user.user.id, roomId, ArchiveRoomInputSchema.parse(request.body)));
  });

  for (const [action, operation] of [
    ["pause", dependencies.rooms.pauseRoom],
    ["resume", dependencies.rooms.resumeRoom],
    ["close", dependencies.rooms.closeRoom],
  ] as const) {
    app.post(`/api/rooms/:roomId/${action}`, async (request) => {
      const user = await identity(request);
      const { roomId } = RoomIdParamsSchema.parse(request.params);
      return success(await operation(user.user.id, roomId));
    });
  }
}
