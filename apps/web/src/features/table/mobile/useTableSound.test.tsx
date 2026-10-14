import type { ProjectedAction, ProjectedHand, ProjectedSeat } from "@paiyouju/shared";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { settlementSoundForHero, useTableSound } from "./useTableSound.js";

function installSampleAudio() {
  const requested: string[] = [];
  const started: string[] = [];
  const tones: number[] = [];
  const originalAudioContext = window.AudioContext;
  const originalFetch = globalThis.fetch;
  class FakeAudioContext {
    readonly currentTime = 1;
    readonly destination = {};
    readonly state = "running";
    close = vi.fn().mockResolvedValue(undefined);
    createBufferSource = () => {
      const source = {
        buffer: null as (AudioBuffer & { readonly path?: string }) | null,
        connect: vi.fn(),
        start: () => started.push(source.buffer?.path ?? "unknown"),
      };
      return source;
    };
    createGain = () => ({ connect: vi.fn(), gain: { exponentialRampToValueAtTime: vi.fn(), setValueAtTime: vi.fn() } });
    createOscillator = () => {
      const frequency = { value: 0 };
      return { connect: vi.fn(), frequency, start: () => tones.push(frequency.value), stop: vi.fn(), type: "sine" };
    };
    decodeAudioData = vi.fn(async (data: ArrayBuffer) => ({ path: (data as ArrayBuffer & { readonly path: string }).path }) as unknown as AudioBuffer);
    resume = vi.fn().mockResolvedValue(undefined);
  }
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    requested.push(path);
    const encoded = new ArrayBuffer(8) as ArrayBuffer & { path: string };
    encoded.path = path;
    return { arrayBuffer: async () => encoded, ok: true } as unknown as Response;
  });
  Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeAudioContext });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: fetchMock });
  return {
    requested,
    restore: () => {
      Object.defineProperty(window, "AudioContext", { configurable: true, value: originalAudioContext });
      Object.defineProperty(globalThis, "fetch", { configurable: true, value: originalFetch });
    },
    started,
    tones,
  };
}

describe("useTableSound", () => {
  beforeEach(() => window.localStorage.clear());

  it("persists only the local sound preference and toggles without changing table state", () => {
    const hand = { actionHistory: [], board: [], currentActorSeat: null, currentBet: 0, handId: "30000000-0000-4000-8000-000000000001", handNumber: 1, legalActions: null, mainPot: 0, ownHoleCards: ["As", "Kd"], publicHoleCards: {}, runoutBoards: null, runoutResults: null, runoutVote: null, sidePots: [], street: "preflop", turnDeadlineAt: null } satisfies ProjectedHand;
    const { result } = renderHook(() => useTableSound(hand, "user-a"));
    expect(result.current.enabled).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.enabled).toBe(false);
    expect(window.localStorage.getItem("wepoker.table-sound.enabled")).toBe("false");
    expect(Object.keys(window.localStorage)).toEqual(["wepoker.table-sound.enabled"]);
  });

  it("unlocks a suspended browser audio context on the first user gesture", async () => {
    const resume = vi.fn().mockResolvedValue(undefined);
    const start = vi.fn();
    const stop = vi.fn();
    class FakeAudioContext {
      readonly currentTime = 1;
      readonly destination = {};
      readonly state = "suspended";
      close = vi.fn().mockResolvedValue(undefined);
      createGain = () => ({ connect: vi.fn(), gain: { exponentialRampToValueAtTime: vi.fn(), setValueAtTime: vi.fn() } });
      createOscillator = () => ({ connect: vi.fn(), frequency: { value: 0 }, start, stop, type: "sine" });
      resume = resume;
    }
    const original = window.AudioContext;
    Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeAudioContext });
    try {
      renderHook(() => useTableSound(null, "user-a"));
      await act(async () => {
        window.dispatchEvent(new PointerEvent("pointerdown"));
        window.dispatchEvent(new TouchEvent("touchend"));
        await Promise.resolve();
      });
      expect(resume).toHaveBeenCalledOnce();
      expect(start).toHaveBeenCalledOnce();
      expect(stop).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(window, "AudioContext", { configurable: true, value: original });
    }
  });

  it("supports persisted volume, suppresses background playback, and ignores reduced-motion", () => {
    const start = vi.fn();
    const peaks: number[] = [];
    class FakeAudioContext {
      readonly currentTime = 1;
      readonly destination = {};
      readonly state = "running";
      close = vi.fn().mockResolvedValue(undefined);
      createGain = () => ({ connect: vi.fn(), gain: { exponentialRampToValueAtTime: (value: number) => peaks.push(value), setValueAtTime: vi.fn() } });
      createOscillator = () => ({ connect: vi.fn(), frequency: { value: 0 }, start, stop: vi.fn(), type: "sine" });
      resume = vi.fn().mockResolvedValue(undefined);
    }
    const originalAudio = window.AudioContext;
    const originalVisibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeAudioContext });
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as typeof window.matchMedia;
    try {
      const { result } = renderHook(() => useTableSound(null, "user-a", null, true));
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      act(() => result.current.play("chip"));
      expect(start).not.toHaveBeenCalled();
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      act(() => result.current.setVolume(0.4));
      act(() => result.current.play("chip"));
      expect(start).toHaveBeenCalledOnce();
      expect(Math.max(...peaks)).toBeGreaterThanOrEqual(0.08);
      expect(window.localStorage.getItem("wepoker.table-sound.volume")).toBe("0.4");
    } finally {
      Object.defineProperty(window, "AudioContext", { configurable: true, value: originalAudio });
      if (originalVisibility) Object.defineProperty(document, "visibilityState", originalVisibility);
      window.matchMedia = originalMatchMedia;
    }
  });

  it("alerts only when the hero becomes actor and baselines reconnects without catch-up sound", () => {
    const frequencies: number[] = [];
    const start = vi.fn();
    class FakeAudioContext {
      readonly currentTime = 1;
      readonly destination = {};
      readonly state = "running";
      close = vi.fn().mockResolvedValue(undefined);
      createGain = () => ({ connect: vi.fn(), gain: { exponentialRampToValueAtTime: vi.fn(), setValueAtTime: vi.fn() } });
      createOscillator = () => {
        const frequency = { value: 0 };
        return { connect: vi.fn(), frequency, start: () => { frequencies.push(frequency.value); start(); }, stop: vi.fn(), type: "sine" };
      };
      resume = vi.fn().mockResolvedValue(undefined);
    }
    const original = window.AudioContext;
    Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeAudioContext });
    const hand = (actor: number | null, handId = "30000000-0000-4000-8000-000000000001") => ({
      actionHistory: [], board: [], currentActorSeat: actor, currentBet: 0, handId, handNumber: 1,
      legalActions: null, mainPot: 0, ownHoleCards: ["As", "Kd"], publicHoleCards: {}, runoutBoards: null, runoutResults: null, runoutVote: null, sidePots: [], street: "preflop", turnDeadlineAt: null,
    }) satisfies ProjectedHand;
    try {
      const { rerender } = renderHook(
        ({ active, current }: { readonly active: boolean; readonly current: ProjectedHand }) => useTableSound(current, "user-a", 1, active),
        { initialProps: { active: true, current: hand(0) } },
      );
      rerender({ active: true, current: hand(1) });
      expect(frequencies).toEqual([880]);
      rerender({ active: false, current: hand(1) });
      rerender({ active: true, current: hand(0, "30000000-0000-4000-8000-000000000002") });
      expect(start).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(window, "AudioContext", { configurable: true, value: original });
    }
  });

  it("deduplicates supplied deal, board and win samples while retaining the chip tone", async () => {
    const samples = installSampleAudio();
    const hand = (
      handId: string,
      board: readonly string[],
      actionHistory: ProjectedHand["actionHistory"],
    ) => ({
      actionHistory,
      board: [...board],
      currentActorSeat: null,
      currentBet: 0,
      handId,
      handNumber: 1,
      legalActions: null,
      mainPot: 0,
      ownHoleCards: ["As", "Kd"],
      publicHoleCards: {},
      runoutBoards: null,
      runoutResults: null,
      runoutVote: null,
      sidePots: [],
      street: "preflop",
      turnDeadlineAt: null,
    }) satisfies ProjectedHand;
    const first = "30000000-0000-4000-8000-000000000001";
    const second = "30000000-0000-4000-8000-000000000002";
    try {
      const { rerender } = renderHook(
        ({ current }: { readonly current: ProjectedHand }) => useTableSound(current, "hero"),
        { initialProps: { current: hand(first, [], []) } },
      );
      rerender({ current: hand(second, [], []) });
      rerender({ current: hand(second, [], []) });
      rerender({ current: hand(second, ["2c", "3d", "4h"], []) });
      rerender({ current: hand(second, ["2c", "3d", "4h"], []) });
      const blind: ProjectedHand["actionHistory"][number] = { amount: 10, eventType: "BLIND_POSTED", playerId: "villain", seatIndex: 1, stateVersion: 1 };
      rerender({ current: hand(second, ["2c", "3d", "4h"], [blind]) });
      const award: ProjectedHand["actionHistory"][number] = { amount: 20, eventType: "POT_AWARDED", potIndex: 0, stateVersion: 2, winners: ["hero"] };
      rerender({ current: hand(second, ["2c", "3d", "4h"], [blind, award]) });
      await waitFor(() => expect(samples.started).toEqual(expect.arrayContaining([
        "/audio/table/sfx/fapai.wav",
        "/audio/table/sfx/fashoupai.wav",
        "/audio/table/sfx/win.wav",
      ])));
      expect(samples.started.filter((path) => path === "/audio/table/sfx/fashoupai.wav")).toHaveLength(1);
      expect(samples.started.filter((path) => path === "/audio/table/sfx/fapai.wav")).toHaveLength(1);
      expect(samples.started.filter((path) => path === "/audio/table/sfx/win.wav")).toHaveLength(1);
      expect(samples.tones).toEqual([720]);
    } finally {
      samples.restore();
    }
  });

  it("plays the supplied win sample only when the current player receives a pot award", async () => {
    const samples = installSampleAudio();
    const makeHand = (actionHistory: ProjectedHand["actionHistory"]) => ({
      actionHistory,
      board: ["2c", "3d", "4h", "5s", "6c"],
      currentActorSeat: null,
      currentBet: 0,
      handId: "30000000-0000-4000-8000-000000000009",
      handNumber: 9,
      legalActions: null,
      mainPot: 40,
      ownHoleCards: ["As", "Kd"],
      publicHoleCards: {},
      runoutBoards: null,
      runoutResults: null,
      runoutVote: null,
      sidePots: [10],
      street: "showdown",
      turnDeadlineAt: null,
    }) satisfies ProjectedHand;
    try {
      const { rerender } = renderHook(
        ({ current }: { readonly current: ProjectedHand }) => useTableSound(current, "hero"),
        { initialProps: { current: makeHand([]) } },
      );
      const lostMain: ProjectedAction = { amount: 40, eventType: "POT_AWARDED", potIndex: 0, stateVersion: 1, winners: ["villain"] };
      rerender({ current: makeHand([lostMain]) });
      expect(samples.requested).not.toContain("/audio/table/sfx/win.wav");

      const wonSide: ProjectedAction = { amount: 10, eventType: "POT_AWARDED", potIndex: 1, stateVersion: 2, winners: ["hero", "third-player"] };
      rerender({ current: makeHand([lostMain, wonSide]) });
      await waitFor(() => expect(samples.started).toContain("/audio/table/sfx/win.wav"));
      expect(samples.started.filter((path) => path === "/audio/table/sfx/win.wav")).toHaveLength(1);
    } finally {
      samples.restore();
    }
  });

  it("treats a positive pure chip return as a winning receipt", async () => {
    const samples = installSampleAudio();
    const makeHand = (actionHistory: ProjectedHand["actionHistory"]) => ({
      actionHistory,
      board: ["2c", "3d", "4h", "5s", "6c"],
      currentActorSeat: null,
      currentBet: 0,
      handId: "30000000-0000-4000-8000-000000000010",
      handNumber: 10,
      legalActions: null,
      mainPot: 0,
      ownHoleCards: ["As", "Kd"],
      publicHoleCards: {},
      runoutBoards: null,
      runoutResults: null,
      runoutVote: null,
      sidePots: [],
      street: "showdown",
      turnDeadlineAt: null,
    }) satisfies ProjectedHand;
    try {
      const { rerender } = renderHook(
        ({ current }: { readonly current: ProjectedHand }) => useTableSound(current, "hero"),
        { initialProps: { current: makeHand([]) } },
      );
      const returned: ProjectedAction = {
        amount: 10,
        eventType: "UNCALLED_BET_RETURNED",
        playerId: "hero",
        stateVersion: 1,
      };
      rerender({ current: makeHand([returned]) });
      await waitFor(() => expect(samples.started).toContain("/audio/table/sfx/win.wav"));
    } finally {
      samples.restore();
    }
  });

  it("classifies every main, side, split, or double-runout award by winner membership", () => {
    expect(settlementSoundForHero(["villain", "hero"], "hero")).toBe("win");
    expect(settlementSoundForHero(["villain"], "hero")).toBe("chip");
  });

  it("plays the supplied public-card sample for each staged double-board deal", async () => {
    const samples = installSampleAudio();
    const hand = {
      actionHistory: [], board: [], currentActorSeat: null, currentBet: 0,
      handId: "30000000-0000-4000-8000-000000000006", handNumber: 6,
      legalActions: null, mainPot: 0, ownHoleCards: ["As", "Kd"], publicHoleCards: {},
      runoutBoards: null, runoutResults: null, runoutVote: null, sidePots: [], street: "showdown", turnDeadlineAt: null,
    } satisfies ProjectedHand;
    try {
      const { rerender } = renderHook(
        ({ count }: { readonly count: number }) => useTableSound(hand, "hero", null, true, [], count),
        { initialProps: { count: 0 } },
      );
      rerender({ count: 3 });
      rerender({ count: 3 });
      rerender({ count: 6 });
      await waitFor(() => expect(samples.started.filter((path) => path === "/audio/table/sfx/fapai.wav")).toHaveLength(2));
    } finally {
      samples.restore();
    }
  });

  it("uses the supplied countdown, chip-collection and new-squid-round samples", async () => {
    const samples = installSampleAudio();
    try {
      const { result } = renderHook(() => useTableSound(null, "hero"));
      act(() => {
        result.current.play("chipCollect");
        result.current.play("countdown");
        result.current.play("squid");
      });
      await waitFor(() => expect(samples.started).toEqual(expect.arrayContaining([
        "/audio/table/sfx/chipfly.wav",
        "/audio/table/sfx/daojishi.wav",
        "/audio/table/sfx/youyu.wav",
      ])));
    } finally {
      samples.restore();
    }
  });

  it("keeps table interaction safe when browser audio construction fails", () => {
    const original = window.AudioContext;
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: class BrokenAudioContext { constructor() { throw new Error("audio unavailable"); } },
    });
    try {
      const { result } = renderHook(() => useTableSound(null, "hero"));
      expect(() => act(() => result.current.play("chip"))).not.toThrow();
    } finally {
      Object.defineProperty(window, "AudioContext", { configurable: true, value: original });
    }
  });

  it("uses the Safari audio context fallback and plays an audible confirmation when sound is enabled", async () => {
    window.localStorage.setItem("wepoker.table-sound.enabled", "false");
    const starts: number[] = [];
    const peaks: number[] = [];
    class FakeWebkitAudioContext {
      readonly currentTime = 1;
      readonly destination = {};
      readonly state = "running";
      close = vi.fn().mockResolvedValue(undefined);
      createGain = () => ({
        connect: vi.fn(),
        gain: {
          exponentialRampToValueAtTime: (value: number) => peaks.push(value),
          setValueAtTime: vi.fn(),
        },
      });
      createOscillator = () => ({
        connect: vi.fn(),
        frequency: { value: 0 },
        start: (at = this.currentTime) => starts.push(at),
        stop: vi.fn(),
        type: "sine",
      });
      resume = vi.fn().mockResolvedValue(undefined);
    }
    const originalAudio = window.AudioContext;
    const safariWindow = window as typeof window & { webkitAudioContext?: typeof AudioContext };
    const originalWebkit = safariWindow.webkitAudioContext;
    Object.defineProperty(window, "AudioContext", { configurable: true, value: undefined });
    Object.defineProperty(window, "webkitAudioContext", { configurable: true, value: FakeWebkitAudioContext });
    try {
      const { result } = renderHook(() => useTableSound(null, "hero"));
      expect(result.current.enabled).toBe(false);
      expect(result.current.volume).toBe(0.7);
      await act(async () => {
        result.current.toggle();
        await Promise.resolve();
      });
      expect(result.current.enabled).toBe(true);
      expect(starts.length).toBeGreaterThan(0);
      expect(Math.max(...peaks)).toBeGreaterThanOrEqual(0.08);
    } finally {
      Object.defineProperty(window, "AudioContext", { configurable: true, value: originalAudio });
      Object.defineProperty(window, "webkitAudioContext", { configurable: true, value: originalWebkit });
    }
  });

  it("defaults to the male voice, persists a female choice, and maps every poker action to its voice sample", async () => {
    const samples = installSampleAudio();
    const makeHand = (actionHistory: readonly ProjectedAction[]): ProjectedHand => ({
      actionHistory: [...actionHistory], board: [], currentActorSeat: null, currentBet: 20,
      handId: "30000000-0000-4000-8000-000000000010", handNumber: 10, legalActions: null,
      mainPot: 40, ownHoleCards: ["As", "Kd"], publicHoleCards: {}, runoutBoards: null, runoutResults: null, runoutVote: null, sidePots: [], street: "preflop", turnDeadlineAt: null,
    });
    const actions: ProjectedAction[] = [];
    const add = (event: ProjectedAction) => { actions.push(event); return makeHand(actions); };
    try {
      const { result, rerender } = renderHook(
        ({ current }: { readonly current: ProjectedHand }) => useTableSound(current, "hero"),
        { initialProps: { current: makeHand(actions) } },
      );
      expect(result.current.voiceGender).toBe("male");
      rerender({ current: add({ amount: 20, eventType: "PLAYER_CALLED", playerId: "villain", stateVersion: 1, street: "preflop" }) });
      await waitFor(() => expect(samples.started).toContain("/audio/table/voices/male/male_call.wav"));

      act(() => result.current.setVoiceGender("female"));
      expect(window.localStorage.getItem("wepoker.table-sound.voice-gender")).toBe("female");
      rerender({ current: add({ amount: 40, eventType: "PLAYER_BET", playerId: "villain", stateVersion: 2, street: "flop" }) });
      rerender({ current: add({ amount: 80, eventType: "PLAYER_RAISED", playerId: "villain", stateVersion: 3, street: "flop" }) });
      rerender({ current: add({ eventType: "PLAYER_CHECKED", playerId: "villain", stateVersion: 4, street: "turn" }) });
      rerender({ current: add({ eventType: "PLAYER_FOLDED", playerId: "villain", stateVersion: 5, street: "turn" }) });
      rerender({ current: add({ amount: 120, eventType: "PLAYER_ALL_IN", playerId: "villain", stateVersion: 6, street: "river" }) });

      await waitFor(() => expect(samples.started).toEqual(expect.arrayContaining([
        "/audio/table/voices/female/female_raise.wav",
        "/audio/table/voices/female/female_check.wav",
        "/audio/table/voices/female/female_fold.wav",
        "/audio/table/voices/female/female_allin.wav",
      ])));
    } finally {
      samples.restore();
    }
  });

  it("plays sit and stand samples only for live seat membership changes", async () => {
    const samples = installSampleAudio();
    const seat = (seatIndex: number, userId: string): ProjectedSeat => ({
      committedThisStreet: 0, connected: true, hasFolded: false, isAllIn: false,
      isBigBlind: false, isCurrentActor: false, isDealer: false, isSmallBlind: false,
      nickname: userId, playStatus: "ACTIVE", publicHandLabel: null, reservedAwayEndsAt: null,
      seatIndex, stack: 2_000, startingStack: 2_000, squidMarked: false, squidRoundParticipant: false, userId, voluntarilyRevealed: false,
    });
    const first = seat(0, "hero");
    const second = seat(1, "villain");
    try {
      const { rerender } = renderHook(
        ({ active, seats }: { readonly active: boolean; readonly seats: readonly ProjectedSeat[] }) => useTableSound(null, "hero", null, active, seats),
        { initialProps: { active: true, seats: [first] } },
      );
      expect(samples.started).toEqual([]);
      rerender({ active: true, seats: [first, second] });
      await waitFor(() => expect(samples.started).toContain("/audio/table/sfx/seat_metal_hit.wav"));
      rerender({ active: true, seats: [first] });
      await waitFor(() => expect(samples.started).toContain("/audio/table/sfx/stand_whoosh.wav"));
      const count = samples.started.length;
      rerender({ active: false, seats: [first, second] });
      rerender({ active: true, seats: [first, second] });
      expect(samples.started).toHaveLength(count);
    } finally {
      samples.restore();
    }
  });
});
