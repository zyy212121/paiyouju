import { fileURLToPath } from "node:url";
import { z } from "zod";

export const MAX_POINTS = 2_000_000_000;
export const SESSION_TTL_DAYS = 14;

const PostgreSqlUrlSchema = z.string().url().refine(
  (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
  "must be a PostgreSQL URL",
);

const OBVIOUSLY_WEAK_VALUES = new Set([
  "123456",
  "change-me",
  "changeme",
  "password",
  "secret",
]);

const OptionalBooleanSchema = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return value;
}, z.boolean().optional());

function isStrongProductionDatabaseUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    const password = decodeURIComponent(parsed.password).trim();
    const normalized = password.toLowerCase();
    return parsed.username.length > 0
      && password.length >= 16
      && !OBVIOUSLY_WEAK_VALUES.has(normalized)
      && !/^(?:example|placeholder|replace[-_ ]?with)/u.test(normalized);
  } catch {
    return false;
  }
}

const EnvironmentSchema = z
  .object({
    ALLOW_LEGACY_USERNAME_LOGIN: OptionalBooleanSchema,
    ADMIN_NICKNAME: z
      .string()
      .trim()
      .min(1)
      .refine((value) => Array.from(value).length <= 20)
      .refine((value) => !/\p{Cc}/u.test(value))
      .refine((value) => !/[<>]/.test(value))
      .default("管理员"),
    ADMIN_ROOM_CONNECTION_PROBES_ENABLED: OptionalBooleanSchema,
    ADMIN_ROOM_FILE_LOG_ENABLED: OptionalBooleanSchema,
    ADMIN_USERNAME: z
      .string()
      .trim()
      .min(3)
      .max(32)
      .regex(/^[A-Za-z0-9_]+$/)
      .default("admin"),
    APP_DOMAIN: z
      .string()
      .trim()
      .min(1)
      .max(253)
      .regex(/^(?:localhost|(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*)$/u)
      .default("localhost"),
    APP_VERSION: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[0-9A-Za-z][0-9A-Za-z.+_-]*$/u)
      .default("0.0.0-dev"),
    BACKUP_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(7),
    BOT_ACCOUNT_PASSWORD: z.string().min(8).max(128).optional(),
    CLIENT_ORIGIN: z.string().url(),
    DATABASE_URL: PostgreSqlUrlSchema,
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(20).default(10),
    DEV_SEED_PASSWORD: z.string().min(8).max(128).optional(),
    HOST: z.string().min(1).default("0.0.0.0"),
    INITIAL_USER_POINTS: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_POINTS)
      .default(10_000),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    MAX_SOCKETS_PER_USER: z.coerce.number().int().min(1).max(20).default(5),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
    RUNTIME_IDLE_EVICTION_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
    SESSION_COOKIE_NAME: z.literal("wepoker_session").default("wepoker_session"),
    SESSION_TTL_DAYS: z.coerce.number().int().refine((value) => value === 14).default(14),
    SHADOW_DATABASE_URL: PostgreSqlUrlSchema.optional(),
    TEST_FIXED_DECK: z.enum(["standard", "step6_5_acceptance"]).optional(),
    TEST_TABLE_FAULT: z.enum([
      "after-action-snapshot-commit",
      "after-action-commit-before-broadcast",
      "after-settlement-commit",
      "after-settlement-commit-before-broadcast",
      "before-action-receipt-commit",
      "before-settlement-commit",
    ]).optional(),
  })
  .superRefine((environment, context) => {
    if (
      environment.NODE_ENV === "production"
      && OBVIOUSLY_WEAK_VALUES.has(environment.APP_VERSION.toLowerCase())
    ) {
      context.addIssue({
        code: "custom",
        message: "APP_VERSION must be an explicit production version",
        path: ["APP_VERSION"],
      });
    }
    if (
      environment.NODE_ENV === "production"
      && new URL(environment.CLIENT_ORIGIN).protocol !== "https:"
    ) {
      context.addIssue({
        code: "custom",
        message: "CLIENT_ORIGIN must use HTTPS in production",
        path: ["CLIENT_ORIGIN"],
      });
    }
    if (
      environment.NODE_ENV === "production"
      && !isStrongProductionDatabaseUrl(environment.DATABASE_URL)
    ) {
      context.addIssue({
        code: "custom",
        message: "DATABASE_URL must contain a non-placeholder production credential",
        path: ["DATABASE_URL"],
      });
    }
    if (environment.NODE_ENV === "production" && environment.DEV_SEED_PASSWORD) {
      context.addIssue({
        code: "custom",
        message: "DEV_SEED_PASSWORD must not be set in production",
        path: ["DEV_SEED_PASSWORD"],
      });
    }
    if (environment.NODE_ENV === "production" && environment.BOT_ACCOUNT_PASSWORD) {
      context.addIssue({
        code: "custom",
        message: "BOT_ACCOUNT_PASSWORD must not be set in production",
        path: ["BOT_ACCOUNT_PASSWORD"],
      });
    }
    if (environment.NODE_ENV === "production" && environment.ALLOW_LEGACY_USERNAME_LOGIN === true) {
      context.addIssue({
        code: "custom",
        message: "ALLOW_LEGACY_USERNAME_LOGIN cannot be enabled in production",
        path: ["ALLOW_LEGACY_USERNAME_LOGIN"],
      });
    }
    if (environment.NODE_ENV !== "test" && environment.TEST_FIXED_DECK) {
      context.addIssue({
        code: "custom",
        message: "TEST_FIXED_DECK is allowed only when NODE_ENV=test",
        path: ["TEST_FIXED_DECK"],
      });
    }
    if (environment.NODE_ENV !== "test" && environment.TEST_TABLE_FAULT) {
      context.addIssue({
        code: "custom",
        message: "TEST_TABLE_FAULT is allowed only when NODE_ENV=test",
        path: ["TEST_TABLE_FAULT"],
      });
    }
  })
  .transform((environment) => ({
    ...environment,
    ALLOW_LEGACY_USERNAME_LOGIN: environment.ALLOW_LEGACY_USERNAME_LOGIN ?? environment.NODE_ENV !== "production",
    ADMIN_ROOM_CONNECTION_PROBES_ENABLED: environment.ADMIN_ROOM_CONNECTION_PROBES_ENABLED ?? environment.NODE_ENV !== "production",
    ADMIN_ROOM_FILE_LOG_ENABLED: environment.ADMIN_ROOM_FILE_LOG_ENABLED ?? environment.NODE_ENV !== "production",
  }))
  .readonly();

export type Environment = z.infer<typeof EnvironmentSchema>;

export function resolveRootEnvironmentPath(moduleUrl: string): string {
  return fileURLToPath(new URL("../../../.env", moduleUrl));
}

export function loadEnvironment(source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): Environment {
  return EnvironmentSchema.parse(source);
}
