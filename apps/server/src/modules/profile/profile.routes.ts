import { ProfileUpdateInputSchema } from "@paiyouju/shared";
import type { FastifyInstance } from "fastify";

import type { Environment } from "../../config/environment.js";
import { success } from "../../http/api-error.js";
import { requireAuthentication } from "../../http/authentication.js";
import type { SessionService } from "../sessions/session.service.js";
import type { ProfileService } from "./profile.service.js";

interface ProfileRoutesDependencies {
  readonly environment: Environment;
  readonly profile: ProfileService;
  readonly sessions: SessionService;
}

export function registerProfileRoutes(app: FastifyInstance, dependencies: ProfileRoutesDependencies): void {
  app.get("/api/profile", async (request) => {
    const identity = await requireAuthentication(request, dependencies.sessions, dependencies.environment.SESSION_COOKIE_NAME);
    return success(await dependencies.profile.get(identity.user.id));
  });

  app.patch("/api/profile", async (request) => {
    const identity = await requireAuthentication(request, dependencies.sessions, dependencies.environment.SESSION_COOKIE_NAME);
    return success(await dependencies.profile.update(identity.user.id, ProfileUpdateInputSchema.parse(request.body)));
  });
}
