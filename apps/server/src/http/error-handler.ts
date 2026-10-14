import type { FastifyError, FastifyInstance } from "fastify";
import { PokerRuleError } from "@paiyouju/poker-core";
import { ZodError } from "zod";

import { ApiError } from "./api-error.js";
import type { Environment } from "../config/environment.js";

export function installErrorHandler(
  app: FastifyInstance,
  environment?: Environment,
): void {
  app.setErrorHandler(async (error: FastifyError, request, reply) => {
    if (error instanceof ApiError) {
      if (
        error.code === "AUTH_REQUIRED" &&
        environment &&
        request.cookies[environment.SESSION_COOKIE_NAME]
      ) {
        reply.clearCookie(environment.SESSION_COOKIE_NAME, {
          httpOnly: true,
          path: "/",
          sameSite: "lax",
          secure: environment.NODE_ENV === "production",
        });
      }
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, requestId: request.id },
      });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "请求参数不合法",
          requestId: request.id,
        },
      });
    }
    if (error instanceof PokerRuleError) {
      return reply.code(409).send({
        error: {
          code: error.code,
          message: "扑克规则拒绝了该操作",
          requestId: request.id,
        },
      });
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2003"
    ) {
      return reply.code(409).send({
        error: {
          code: "REFERENCE_CONFLICT",
          message: "关联数据冲突",
          requestId: request.id,
        },
      });
    }
    if (error.statusCode === 413) {
      return reply.code(413).send({
        error: { code: "BODY_TOO_LARGE", message: "请求内容过大", requestId: request.id },
      });
    }
    if (error.statusCode === 400) {
      return reply.code(400).send({
        error: {
          code: "INVALID_REQUEST",
          message: "请求格式不合法",
          requestId: request.id,
        },
      });
    }
    if (error.statusCode === 415) {
      return reply.code(415).send({
        error: {
          code: "UNSUPPORTED_MEDIA_TYPE",
          message: "不支持的内容类型",
          requestId: request.id,
        },
      });
    }
    if (error.statusCode === 429) {
      return reply.code(429).send({
        error: { code: "RATE_LIMITED", message: "请求过于频繁", requestId: request.id },
      });
    }

    request.log.error(
      { errorName: error.name, requestId: request.id },
      "request failed",
    );
    return reply.code(500).send({
      error: { code: "INTERNAL_ERROR", message: "服务器内部错误", requestId: request.id },
    });
  });
}
