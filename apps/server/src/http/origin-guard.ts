import type { FastifyInstance } from "fastify";

import { ApiError } from "./api-error.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function installOriginGuard(app: FastifyInstance, trustedOrigin: string): void {
  app.addHook("onRequest", async (request) => {
    if (!request.url.startsWith("/api/") || SAFE_METHODS.has(request.method)) return;
    if (request.headers.origin !== trustedOrigin) {
      throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "访问地址与服务器配置不一致，请使用启动终端显示的网址重新打开");
    }
    if (request.headers["x-wepoker-request"] !== "1") {
      throw new ApiError(403, "CSRF_HEADER_REQUIRED", "请求缺少安全标记");
    }
  });
}
