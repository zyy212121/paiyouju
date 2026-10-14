import type { FastifyInstance } from "fastify";

import type { Environment } from "../../config/environment.js";
import { success } from "../../http/api-error.js";
import { requireAuthentication } from "../../http/authentication.js";
import type { SessionService } from "../sessions/session.service.js";
import { LedgerQuerySchema } from "./wallet.schemas.js";
import type { ReturnTypeCreateWalletService } from "./wallet.types.js";

interface WalletRoutesDependencies {
  readonly environment: Environment;
  readonly sessions: SessionService;
  readonly wallet: ReturnTypeCreateWalletService;
}

export function registerWalletRoutes(app: FastifyInstance, dependencies: WalletRoutesDependencies): void {
  app.get("/api/wallet", async (request) => {
    const identity = await requireAuthentication(request, dependencies.sessions, dependencies.environment.SESSION_COOKIE_NAME);
    return success(await dependencies.wallet.getWallet(identity.user.id));
  });

  app.get("/api/wallet/ledger", async (request) => {
    const identity = await requireAuthentication(request, dependencies.sessions, dependencies.environment.SESSION_COOKIE_NAME);
    const query = LedgerQuerySchema.parse(request.query);
    return success(await dependencies.wallet.listLedger(identity.user.id, query));
  });
}
