import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("mobile safe-area CSS contract", () => {
  it("protects normal content, sticky header, bottom navigation, and dialogs on all four edges", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    expect(css).toContain("padding-top: var(--safe-top)");
    expect(css).toContain(".app-header { top: var(--safe-top); }");
    expect(css).toContain("padding-bottom: max(.5rem, var(--safe-bottom))");
    for (const edge of ["top", "right", "bottom", "left"]) {
      expect(css).toContain(`padding-${edge}: max(1rem, var(--safe-${edge}))`);
    }
  });

  it("defines a 100dvh overflow-locked green stage without an oval table body", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles/table.css"), "utf8");
    const stage = css.slice(css.indexOf(".mobile-table-stage"), css.indexOf(".table-stage-texture"));
    expect(stage).toContain("height: 100dvh");
    expect(stage).toContain("min-height: 100dvh");
    expect(stage).toContain("overflow: hidden");
    expect(stage).toContain("#0a3e32");
    expect(stage).not.toMatch(/border-radius:\s*(?:50%|46%)/u);
    for (const edge of ["top", "right", "bottom", "left"]) expect(css).toContain(`env(safe-area-inset-${edge})`);
  });
});
