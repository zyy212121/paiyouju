import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DeadlineRing } from "./DeadlineRing.js";

describe("DeadlineRing", () => {
  it("stays visible at zero until the authoritative deadline is removed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    try {
      const view = render(<DeadlineRing deadline="2026-01-01T00:00:01.000Z" durationSeconds={10} label="行动倒计时" />);
      act(() => vi.advanceTimersByTime(1_200));
      expect(screen.getByLabelText(/行动倒计时，剩余 0\.0 秒/u)).toBeInTheDocument();
      expect(screen.getByText("0")).toBeInTheDocument();

      view.rerender(<DeadlineRing deadline={null} durationSeconds={10} label="行动倒计时" />);
      expect(screen.queryByLabelText(/行动倒计时/u)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
