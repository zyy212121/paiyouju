import type { FastifyRequest } from "fastify";

import { ApiError } from "./api-error.js";
import type { AuthenticatedIdentity, SessionService } from "../modules/sessions/session.service.js";

export async function requireAuthentication(
  request: FastifyRequest,
  sessions: SessionService,
  cookieName: string,
): Promise<AuthenticatedIdentity> {
  const identity = await sessions.authenticate(request.cookies[cookieName]);
  if (!identity) {
    throw new ApiError(401, "AUTH_REQUIRED", "需要先登录");
  }
  return identity;
}

export async function requireAdministrator(
  request: FastifyRequest,
  sessions: SessionService,
  cookieName: string,
): Promise<AuthenticatedIdentity> {
  const identity = await requireAuthentication(request, sessions, cookieName);
  if (identity.user.role !== "ADMIN") {
    throw new ApiError(403, "ADMIN_REQUIRED", "需要管理员权限");
  }
  return identity;
}
