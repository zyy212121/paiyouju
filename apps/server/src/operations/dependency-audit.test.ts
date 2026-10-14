import { describe, expect, it } from "vitest";

import { assessDependencyAudit } from "./dependency-audit.js";

describe("dependency audit policy", () => {
  it("allows only the documented Prisma configuration-only advisory", () => {
    expect(assessDependencyAudit({
      advisories: {
        "1145093": {
          findings: [{ paths: ["apps__server>prisma>@prisma/config>deepmerge-ts"], version: "7.1.5" }],
          module_name: "deepmerge-ts",
          severity: "high",
          title: "recursive configuration merge",
        },
      },
    })).toMatchObject({ allowedHigh: ["1145093"], blocking: [] });
  });

  it("blocks every other high or critical advisory", () => {
    expect(assessDependencyAudit({
      advisories: {
        other: {
          findings: [{ paths: ["apps__web>reachable-package"], version: "1.0.0" }],
          module_name: "reachable-package",
          severity: "high",
          title: "reachable vulnerability",
        },
      },
    }).blocking).toEqual(["other"]);
  });
});
