import { BindPhoneInputSchema } from "@paiyouju/shared";
import type { FastifyInstance } from "fastify";

import type { Environment } from "../../config/environment.js";
import { success } from "../../http/api-error.js";
import { requireAuthentication } from "../../http/authentication.js";
import type { SessionService } from "../sessions/session.service.js";
import type { PhoneBindingService } from "./phone-binding.service.js";

interface AccountRoutesDependencies {
  readonly environment: Environment;
  readonly phoneBinding: PhoneBindingService;
  readonly sessions: SessionService;
}

export function registerAccountRoutes(app: FastifyInstance, dependencies: AccountRoutesDependencies): void {
  app.post(
    "/api/account/phone",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request) => {
      const identity = await requireAuthentication(request, dependencies.sessions, dependencies.environment.SESSION_COOKIE_NAME);
      return success(await dependencies.phoneBinding.bind(identity.user.id, BindPhoneInputSchema.parse(request.body)));
    },
  );
}
