import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConnectionBadge } from "./ConnectionBadge.js";

describe("ConnectionBadge", () => {
  it.each([
    ["connected", "已连接"],
    ["reconnecting", "正在重连"],
    ["disconnected", "已断开"],
  ] as const)("renders the %s connection state as text", (status, label) => {
    render(<ConnectionBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
