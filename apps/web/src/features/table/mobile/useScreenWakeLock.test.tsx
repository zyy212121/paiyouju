import { render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";

import { useScreenWakeLock } from "./useScreenWakeLock.js";

function Harness({ active }: { readonly active: boolean }) {
  useScreenWakeLock(active);
  useEffect(() => undefined, []);
  return null;
}

describe("useScreenWakeLock", () => {
  it("requests a screen wake lock and releases it when leaving the table", async () => {
    const sentinel = new EventTarget() as EventTarget & { release: () => Promise<void>; released: boolean };
    sentinel.released = false;
    sentinel.release = vi.fn(async () => { sentinel.released = true; sentinel.dispatchEvent(new Event("release")); });
    const request = vi.fn(async () => sentinel);
    const original = Object.getOwnPropertyDescriptor(navigator, "wakeLock");
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });
    try {
      const view = render(<Harness active />);
      await waitFor(() => expect(request).toHaveBeenCalledWith("screen"));
      view.rerender(<Harness active={false} />);
      await waitFor(() => expect(sentinel.release).toHaveBeenCalledTimes(1));
    } finally {
      if (original) Object.defineProperty(navigator, "wakeLock", original);
      else Reflect.deleteProperty(navigator, "wakeLock");
    }
  });

  it("is a safe no-op when the browser does not expose the secure-context API", () => {
    const original = Object.getOwnPropertyDescriptor(navigator, "wakeLock");
    Reflect.deleteProperty(navigator, "wakeLock");
    try {
      expect(() => render(<Harness active />)).not.toThrow();
    } finally {
      if (original) Object.defineProperty(navigator, "wakeLock", original);
    }
  });
});
