const FORBIDDEN_KEY_PARTS = [
  "authorization",
  "cookie",
  "csrf",
  "databasepassword",
  "databaseurl",
  "dbpassword",
  "deck",
  "holecards",
  "password",
  "phonenumber",
  "remainingdeck",
  "session",
  "snapshotpayload",
  "token",
] as const;

type SafeAuditJson =
  | boolean
  | null
  | number
  | string
  | readonly SafeAuditJson[]
  | { readonly [key: string]: SafeAuditJson };

function forbiddenKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
  return FORBIDDEN_KEY_PARTS.some((part) => normalized.includes(part));
}

function safeString(value: string): string {
  if (/\bpostgres(?:ql)?:\/\//iu.test(value) || /\bDATABASE_URL\b/u.test(value)) {
    return "[REDACTED]";
  }
  return value
    .replace(/\b(1[3-9]\d)\d{4}(\d{4})\b/gu, "$1****$2")
    .replace(/[\p{Cc}<>]/gu, " ")
    .trim()
    .slice(0, 500);
}

function sanitize(value: unknown, depth: number): SafeAuditJson | undefined {
  if (depth > 5) return "[TRUNCATED]";
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") return safeString(value);
  if (Array.isArray(value)) {
    return value
      .slice(0, 50)
      .map((entry) => sanitize(entry, depth + 1))
      .filter((entry): entry is SafeAuditJson => entry !== undefined);
  }
  if (typeof value !== "object") return undefined;
  const result: Record<string, SafeAuditJson> = {};
  for (const [key, nested] of Object.entries(value).slice(0, 64)) {
    if (forbiddenKey(key)) continue;
    const safe = sanitize(nested, depth + 1);
    if (
      safe !== undefined
      && !(Array.isArray(safe) && safe.length === 0)
      && !(safe !== null && !Array.isArray(safe) && typeof safe === "object" && Object.keys(safe).length === 0)
    ) result[key.slice(0, 80)] = safe;
  }
  return result;
}

export function sanitizeAuditMetadata(
  metadata: Readonly<Record<string, unknown>>,
): Readonly<Record<string, SafeAuditJson>> {
  const result = sanitize(metadata, 0);
  return result !== null && !Array.isArray(result) && typeof result === "object"
    ? result as Readonly<Record<string, SafeAuditJson>>
    : {};
}
