interface AuditFinding {
  readonly paths?: readonly string[];
  readonly version?: string;
}

interface AuditAdvisory {
  readonly findings?: readonly AuditFinding[];
  readonly module_name?: string;
  readonly severity?: string;
  readonly title?: string;
}

interface AuditPayload {
  readonly advisories?: Readonly<Record<string, AuditAdvisory>>;
}

export interface DependencyAuditAssessment {
  readonly allowedHigh: readonly string[];
  readonly blocking: readonly string[];
  readonly moderateOrLower: readonly string[];
}

function isAcknowledgedPrismaConfigAdvisory(id: string, advisory: AuditAdvisory): boolean {
  const paths = advisory.findings?.flatMap((finding) => finding.paths ?? []) ?? [];
  return id === "1145093"
    && advisory.module_name === "deepmerge-ts"
    && advisory.severity === "high"
    && paths.length > 0
    && paths.every((path) => path.includes(">@prisma/config>deepmerge-ts"));
}

export function assessDependencyAudit(payload: AuditPayload): DependencyAuditAssessment {
  const allowedHigh: string[] = [];
  const blocking: string[] = [];
  const moderateOrLower: string[] = [];
  for (const [id, advisory] of Object.entries(payload.advisories ?? {})) {
    if (advisory.severity === "high" || advisory.severity === "critical") {
      if (isAcknowledgedPrismaConfigAdvisory(id, advisory)) allowedHigh.push(id);
      else blocking.push(id);
    } else moderateOrLower.push(id);
  }
  return { allowedHigh: allowedHigh.sort(), blocking: blocking.sort(), moderateOrLower: moderateOrLower.sort() };
}
