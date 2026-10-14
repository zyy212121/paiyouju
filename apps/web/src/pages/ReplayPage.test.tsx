import type { HandReplay } from "@paiyouju/shared";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getReplay } from "../api/hands.js";
import { ReplayPage } from "./ReplayPage.js";

vi.mock("../api/hands.js", () => ({ getReplay: vi.fn() }));

const initialState: HandReplay["initialState"] = {
  bigBlindSeat: 1,
  blinds: { bigBlind: 20, smallBlind: 10 },
  board: [],
  buttonSeat: 0,
  ownHoleCards: ["As", "Kd"],
  players: [
    { allIn: false, committed: 0, folded: false, holeCards: ["As", "Kd"], holeCardsVisibility: "OWN", nickname: "Alice", seatIndex: 0, stack: 400, userId: "alice" },
    { allIn: false, committed: 0, folded: false, holeCards: null, holeCardsVisibility: "HIDDEN", nickname: "Bob", seatIndex: 1, stack: 400, userId: "bob" },
  ],
  pot: 0,
  pots: [],
  publicHoleCardsAtStart: [],
  smallBlindSeat: 0,
  startingStacks: [{ stack: 400, userId: "alice" }, { stack: 400, userId: "bob" }],
  street: "PREFLOP",
  winners: [],
};

const finalState: HandReplay["finalState"] = {
  board: [],
  players: initialState.players,
  pot: 0,
  pots: [],
  street: "PREFLOP",
  winners: [],
};

const replay: HandReplay = {
  events: [{ actorSeat: null, actorUserId: null, amount: null, automatic: false, cards: null, potIndex: null, raiseTo: null, sequence: 0, stateVersion: null, street: "PREFLOP", type: "HAND_STARTED", visibility: null, winners: [] }],
  finalState,
  handId: "10000000-0000-4000-8000-000000000001",
  initialState,
  schemaVersion: 1,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function ReplayRoutes({ nextHandId }: { readonly nextHandId?: string }) {
  const navigate = useNavigate();
  return <>{nextHandId && <button onClick={() => navigate(`/hands/${nextHandId}/replay`)} type="button">切换回放</button>}<Routes><Route element={<ReplayPage />} path="/hands/:handId/replay" /></Routes></>;
}

describe("ReplayPage playback lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(getReplay).mockResolvedValue(replay);
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("cleans its playback timer when the route unmounts", async () => {
    const rendered = render(<MemoryRouter initialEntries={[`/hands/${replay.handId}/replay`]}><Routes><Route element={<ReplayPage />} path="/hands/:handId/replay" /></Routes></MemoryRouter>);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("步骤 0 / 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "播放" }));
    expect(vi.getTimerCount()).toBe(1);
    rendered.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("labels a purchased reveal as post-hand authorization instead of showdown disclosure", async () => {
    const purchasedReplay: HandReplay = {
      ...replay,
      events: [
        replay.events[0]!,
        { actorSeat: null, actorUserId: null, amount: null, automatic: false, cards: null, potIndex: null, raiseTo: null, sequence: 1, stateVersion: null, street: "PREFLOP", type: "HAND_FINISHED", visibility: null, winners: [] },
        { actorSeat: 1, actorUserId: "bob", amount: null, automatic: false, cards: ["Qc", "Jh"], potIndex: null, raiseTo: null, sequence: 2, stateVersion: null, street: "PREFLOP", type: "CARDS_REVEALED", visibility: "PURCHASED_AFTER_HAND", winners: [] },
      ],
      finalState: {
        ...finalState,
        players: [initialState.players[0]!, { ...initialState.players[1]!, holeCards: ["Qc", "Jh"], holeCardsVisibility: "PURCHASED" }],
      },
    };
    vi.mocked(getReplay).mockResolvedValue(purchasedReplay);
    render(<MemoryRouter initialEntries={[`/hands/${replay.handId}/replay`]}><Routes><Route element={<ReplayPage />} path="/hands/:handId/replay" /></Routes></MemoryRouter>);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole("button", { name: "跳到结束" }));
    expect(screen.getByText("Bob 牌局结束后购买可见")).toBeInTheDocument();
    expect(screen.queryByText("Bob 亮出底牌")).not.toBeInTheDocument();
  });

  it("keeps a late response from an old route out of the current replay", async () => {
    const oldRequest = deferred<HandReplay>();
    const nextReplay: HandReplay = {
      ...replay,
      events: [
        replay.events[0]!,
        { actorSeat: null, actorUserId: null, amount: null, automatic: false, cards: null, potIndex: null, raiseTo: null, sequence: 1, stateVersion: null, street: "PREFLOP", type: "HAND_FINISHED", visibility: null, winners: [] },
      ],
      handId: "10000000-0000-4000-8000-000000000002",
    };
    vi.mocked(getReplay).mockImplementation((handId: string) => handId === replay.handId ? oldRequest.promise : Promise.resolve(nextReplay));
    render(<MemoryRouter initialEntries={[`/hands/${replay.handId}/replay`]}><ReplayRoutes nextHandId={nextReplay.handId} /></MemoryRouter>);
    expect(getReplay).toHaveBeenCalledWith(replay.handId, expect.any(AbortSignal));

    fireEvent.click(screen.getByRole("button", { name: "切换回放" }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("步骤 0 / 2")).toBeInTheDocument();

    await act(async () => { oldRequest.resolve(replay); await Promise.resolve(); });
    expect(screen.getByText("步骤 0 / 2")).toBeInTheDocument();
    expect(screen.queryByText("步骤 0 / 1")).not.toBeInTheDocument();
  });
});
