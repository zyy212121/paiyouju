import { beforeEach, describe, expect, it } from "vitest";

import { useNetworkStore } from "./network-store.js";

describe("network refresh generation", () => {
  beforeEach(() => useNetworkStore.setState({ online: true, pendingWrites: 0, refreshVersion: 0 }));

  it("increments once for each actual offline-to-online transition", () => {
    useNetworkStore.getState().setOnline(false);
    useNetworkStore.getState().setOnline(true);
    expect(useNetworkStore.getState().refreshVersion).toBe(1);
    useNetworkStore.getState().setOnline(true);
    expect(useNetworkStore.getState().refreshVersion).toBe(1);
    useNetworkStore.getState().setOnline(false);
    useNetworkStore.getState().setOnline(true);
    expect(useNetworkStore.getState().refreshVersion).toBe(2);
  });
});
