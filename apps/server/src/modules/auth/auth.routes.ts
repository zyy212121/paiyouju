import type { FastifyInstance, FastifyReply } from "fastify";

import type { Environment } from "../../config/environment.js";
import { success } from "../../http/api-error.js";
import { requireAuthentication } from "../../http/authentication.js";
import type { SessionService } from "../sessions/session.service.js";
import { LoginInputSchema, RegisterInputSchema } from "./auth.schemas.js";
import type { AuthResult } from "./auth.service.js";

interface AuthRoutesDependencies {
  readonly environment: Environment;
  readonly login: (input: ReturnType<typeof LoginInputSchema.parse>) => Promise<AuthResult>;
  readonly register: (input: ReturnType<typeof RegisterInputSchema.parse>) => Promise<AuthResult>;
  readonly sessions: SessionService;
  readonly onSessionRevoked?: (sessionId: string) => void | Promise<void>;
}

function setSessionCookie(
  reply: FastifyReply,
  environment: Environment,
  result: AuthResult,
): void {
  reply.setCookie(environment.SESSION_COOKIE_NAME, result.rawToken, {
    expires: result.expiresAt,
    httpOnly: true,
    maxAge: environment.SESSION_TTL_DAYS * 24 * 60 * 60,
    path: "/",
    sameSite: "lax",
    secure: environment.NODE_ENV === "production",
  });
}

export function registerAuthRoutes(app: FastifyInstance, dependencies: AuthRoutesDependencies): void {
  app.post(
    "/api/auth/register",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const result = await dependencies.register(RegisterInputSchema.parse(request.body));
      setSessionCookie(reply, dependencies.environment, result);
      return reply.code(201).send(success({ user: result.user }));
    },
  );

  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const result = await dependencies.login(LoginInputSchema.parse(request.body));
      setSessionCookie(reply, dependencies.environment, result);
      return success({ user: result.user });
    },
  );

  app.post("/api/auth/logout", async (request, reply) => {
    const identity = await dependencies.sessions.authenticate(
      request.cookies[dependencies.environment.SESSION_COOKIE_NAME],
    );
    await dependencies.sessions.revoke(
      request.cookies[dependencies.environment.SESSION_COOKIE_NAME],
    );
    if (identity) await dependencies.onSessionRevoked?.(identity.sessionId);
    reply.clearCookie(dependencies.environment.SESSION_COOKIE_NAME, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: dependencies.environment.NODE_ENV === "production",
    });
    return success({ loggedOut: true });
  });

  app.get("/api/me", async (request) => {
    const identity = await requireAuthentication(
      request,
      dependencies.sessions,
      dependencies.environment.SESSION_COOKIE_NAME,
    );
    return success(identity.user);
  });
}
