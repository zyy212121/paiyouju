import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { projectedHand, projectedSeat, tableState } from "../../../test/table-fixture.js";
import { BoardCards } from "../BoardCards.js";
import { BuyInModal } from "./BuyInModal.js";
import { CardAnimationCoordinator } from "./CardAnimationCoordinator.js";
import { ChipAwardAnimation } from "./ChipAwardAnimation.js";
import { HeroHand } from "./HeroHand.js";
import { PostHandReviewOverlay } from "./PostHandReviewOverlay.js";
import { TableMenuPopover } from "./TableMenuPopover.js";
import { TableTopBar } from "./TableTopBar.js";

describe("mobile table product components", () => {
  it("renders every top utility control with a non-color network label", () => {
    render(<TableTopBar connection="disconnected" onCart={vi.fn()} onCopyInvite={vi.fn()} onHistory={vi.fn()} onMenu={vi.fn()} onToggleSound={vi.fn()} soundEnabled state={tableState()} />);
    for (const name of ["打开牌桌菜单", "复制邀请信息", "补充牌桌后手", "打开牌桌历史", "关闭牌桌音效", "网络状态：已断开"]) expect(screen.getByLabelText(name)).toBeInTheDocument();
  });

  it("shows safe seat lifecycle controls and honest disabled placeholders", async () => {
    const user = userEvent.setup();
    const seat = { ...projectedSeat(), playStatus: "RESERVED_AWAY" as const, reservedAwayEndsAt: new Date(Date.now() + 60_000).toISOString() };
    const changeVoice = vi.fn();
    render(<TableMenuPopover mySeat={seat} onClose={vi.fn()} onExit={vi.fn()} onOwnerAction={vi.fn()} onReserveAway={vi.fn()} onReturn={vi.fn()} onSoundVolume={vi.fn()} onStand={vi.fn()} onTrusteeship={vi.fn()} onVoiceGenderChange={changeVoice} open soundVolume={0.7} state={tableState({ seats: [seat, projectedSeat(1)] })} voiceGender="male" working={false} />);
    expect(screen.getByRole("button", { name: /回到牌桌/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /站起围观/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /声音/ }));
    expect(screen.getByRole("button", { name: "男声" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "女声" }));
    expect(changeVoice).toHaveBeenCalledWith("female");
    expect(screen.getByRole("slider", { name: "牌桌音量" })).toHaveValue("0.7");
    await user.click(screen.getByRole("button", { name: /钻石说明/ }));
    expect(screen.getByText("每手开局：10 钻石")).toBeInTheDocument();
    expect(screen.getByText("偷偷看：50 钻石")).toBeInTheDocument();
    expect(screen.getByText("发发看：10 钻石")).toBeInTheDocument();
    expect(screen.getByText("行动加时：10 钻石")).toBeInTheDocument();
  });

  it("does not offer reserve-away after leave-after-hand is already armed", () => {
    const seat = { ...projectedSeat(), playStatus: "LEAVE_AFTER_HAND" as const };
    render(<TableMenuPopover mySeat={seat} onClose={vi.fn()} onExit={vi.fn()} onOwnerAction={vi.fn()} onReserveAway={vi.fn()} onReturn={vi.fn()} onSoundVolume={vi.fn()} onStand={vi.fn()} onTrusteeship={vi.fn()} onVoiceGenderChange={vi.fn()} open soundVolume={0.7} state={tableState({ seats: [seat, projectedSeat(1)] })} voiceGender="male" working={false} />);
    expect(screen.queryByRole("button", { name: /保位离桌/u })).not.toBeInTheDocument();
  });

  it("enables squid rules, disables reserve-away, and exposes persistent trusteeship as a pressed toggle", async () => {
    const user = userEvent.setup();
    const toggleTrusteeship = vi.fn();
    const seat = { ...projectedSeat(), squidMarked: true, squidRoundParticipant: true };
    const state = tableState({
      room: { ...tableState().room, specialMode: "SQUID", squidStake: 20 },
      seats: [seat, projectedSeat(1)],
      trusteeshipEnabled: true,
    });
    render(<TableMenuPopover mySeat={seat} onClose={vi.fn()} onExit={vi.fn()} onOwnerAction={vi.fn()} onReserveAway={vi.fn()} onReturn={vi.fn()} onSoundVolume={vi.fn()} onStand={vi.fn()} onTrusteeship={toggleTrusteeship} onVoiceGenderChange={vi.fn()} open soundVolume={0.7} state={state} voiceGender="male" working={false} />);

    const trusteeship = screen.getByRole("button", { name: /取消托管/ });
    expect(trusteeship).toHaveAttribute("aria-pressed", "true");
    await user.click(trusteeship);
    expect(toggleTrusteeship).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: /鱿鱼模式不可保位离桌/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /规则说明/ }));
    expect(screen.getByText(/唯一赢得主池/)).toBeInTheDocument();
    expect(screen.getByText(/每人支付 20 点/)).toBeInTheDocument();
  });

  it.each([
    [
      { runItTwiceEnabled: true, specialMode: "NORMAL" as const },
      /仅在两名玩家进入 All-in 比牌时询问/u,
    ],
    [
      { runItTwiceEnabled: false, specialMode: "SHORT_DECK" as const },
      /仅使用 6 到 A 共 36 张牌/u,
    ],
    [
      { bombPotBlindMultiplier: 3, bombPotIntervalMinutes: 5, runItTwiceEnabled: false, specialMode: "BOMB_POT" as const },
      /每名参赛玩家强制投入 3 BB/u,
    ],
  ])("shows the active room variant rules from the table menu", async (roomOverride, expectedText) => {
    const user = userEvent.setup();
    const state = tableState({ room: { ...tableState().room, ...roomOverride } });
    render(<TableMenuPopover mySeat={state.seats[0] ?? null} onClose={vi.fn()} onExit={vi.fn()} onOwnerAction={vi.fn()} onReserveAway={vi.fn()} onReturn={vi.fn()} onSoundVolume={vi.fn()} onStand={vi.fn()} onTrusteeship={vi.fn()} onVoiceGenderChange={vi.fn()} open soundVolume={0.7} state={state} voiceGender="male" working={false} />);

    await user.click(screen.getByRole("button", { name: /规则说明/u }));
    expect(screen.getByText(expectedText)).toBeInTheDocument();
    expect(screen.queryByText(/托管只代替可选择行动/u)).not.toBeInTheDocument();
  });

  it("opens the room-point top-up slider at its single-purchase maximum", () => {
    render(<BuyInModal bigBlind={20} maximum={2_000} onClose={vi.fn()} onConfirm={vi.fn()} open working={false} />);
    expect(screen.queryByRole("spinbutton", { name: "买入金额" })).not.toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "买入档位" })).toHaveValue("10");
    expect(screen.getByRole("slider", { name: "买入档位" })).toHaveAttribute("aria-valuetext", "第 10 档，2,000 点");
    expect(screen.getByText("2,000")).toBeInTheDocument();
    expect(screen.queryByText(/当前钻石/)).not.toBeInTheDocument();
    expect(screen.queryByText("筹码已用完")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "拒绝并站起" })).not.toBeInTheDocument();
  });

  it("uses exactly ten discrete buy-in levels", async () => {
    const user = userEvent.setup();
    const confirm = vi.fn();
    render(<BuyInModal bigBlind={20} maximum={2_000} onClose={vi.fn()} onConfirm={confirm} open working={false} />);
    const slider = screen.getByRole("slider", { name: "买入档位" });

    fireEvent.change(slider, { target: { value: "4" } });
    expect(slider).toHaveValue("4");
    expect(slider).toHaveAttribute("aria-valuetext", "第 4 档，800 点");
    await user.click(screen.getByRole("button", { name: "确认补充" }));
    expect(confirm).toHaveBeenCalledWith(800);
  });

  it("shows the hero avatar and toggles each card's pending-show state", async () => {
    const hand = projectedHand();
    const reveal = vi.fn();
    const user = userEvent.setup();
    const state = tableState({ canRevealOwnCards: true, hand, ownHandSummary: { category: "PREFLOP", label: "一对 A" } });
    const view = render(<HeroHand mySeat={state.seats[0]!} onReveal={reveal} state={state} working={false} />);
    expect(screen.getByTestId("hero-hand")).toHaveTextContent("一对 A");
    expect(screen.getByTestId("hero-avatar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "将第 1 张底牌设为待亮" })).not.toHaveClass("is-pending-show");
    expect(screen.getByRole("button", { name: "将第 2 张底牌设为待亮" })).not.toHaveClass("is-pending-show");
    await user.click(screen.getByRole("button", { name: "将第 1 张底牌设为待亮" }));
    expect(reveal).toHaveBeenCalledWith(0);

    view.rerender(<HeroHand mySeat={state.seats[0]!} onReveal={reveal} state={{ ...state, pendingShowCardIndices: [0] }} working={false} />);
    expect(screen.getByRole("button", { name: "取消第 1 张底牌待亮" })).toHaveClass("is-pending-show");
    expect(screen.getByLabelText("第 1 张底牌待亮标记")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "取消第 1 张底牌待亮" }));
    expect(reveal).toHaveBeenLastCalledWith(0);
  });

  it("replaces the hero nickname with the hero's latest action status", () => {
    const state = tableState({ hand: projectedHand() });
    render(<HeroHand actionLabel="全下" mySeat={state.seats[0]!} onReveal={vi.fn()} state={state} working={false} />);

    expect(screen.getByText("全下")).toHaveClass("seat-action-label");
    expect(screen.queryByText("十二个中文字符昵称测试玩家")).not.toBeInTheDocument();
  });

  it("anchors the current player's live chat beside the hero avatar", () => {
    const state = tableState();
    const chatMessage = { content: "我的消息 👍", createdAt: "2026-08-29T12:00:00.000Z", id: "40000000-0000-4000-8000-000000000003", roomId: "room-1", sender: { nickname: "自己", seatIndex: 0, userId: "user-0" } } as const;
    render(<HeroHand chatMessage={chatMessage} mySeat={state.seats[0]!} onReveal={vi.fn()} state={state} working={false} />);
    expect(within(screen.getByTestId("hero-avatar")).getByTestId("player-chat-bubble")).toHaveClass("chat-placement-hero");
  });

  it("mirrors stand, reserve-away, fold, trusteeship, and squid-mark states in the hero UI", () => {
    const active = projectedSeat();
    const state = tableState({ hand: projectedHand(), seats: [active, projectedSeat(1)] });
    const view = render(<HeroHand mySeat={active} onReveal={vi.fn()} state={state} working={false} />);

    view.rerender(<HeroHand mySeat={{ ...active, hasFolded: true }} onReveal={vi.fn()} state={{ ...state, seats: [{ ...active, hasFolded: true }, projectedSeat(1)] }} working={false} />);
    expect(screen.getByTestId("hero-hand")).toHaveAttribute("data-player-visual-state", "folded");
    expect(screen.getByTestId("hand-strength")).toHaveTextContent("已弃牌");

    const reserved = { ...active, playStatus: "RESERVED_AWAY" as const, reservedAwayEndsAt: new Date(Date.now() + 60_000).toISOString() };
    view.rerender(<HeroHand mySeat={reserved} onReveal={vi.fn()} state={{ ...state, seats: [reserved, projectedSeat(1)] }} working={false} />);
    expect(screen.getByTestId("hero-hand")).toHaveAttribute("data-player-visual-state", "standing");
    expect(within(screen.getByTestId("hero-avatar")).getByText("站")).toBeInTheDocument();
    expect(screen.getByTestId("hand-strength")).toHaveTextContent("保位离桌");

    const marked = { ...active, squidMarked: true, squidRoundParticipant: true };
    view.rerender(<HeroHand mySeat={marked} onReveal={vi.fn()} state={{ ...state, seats: [marked, projectedSeat(1)], trusteeshipEnabled: true }} working={false} />);
    expect(screen.getByLabelText("我的鱿鱼标记")).toBeInTheDocument();
    expect(screen.getByTestId("hand-strength")).toHaveTextContent("托管中 · 让或弃");
  });

  it("removes the entire hero explanation frame for an unseated spectator", () => {
    const state = tableState({ hand: projectedHand() });
    const { container } = render(<HeroHand mySeat={null} onReveal={vi.fn()} state={state} working={false} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/点击空座|恢复后手/u)).not.toBeInTheDocument();
  });

  it("moves selected review cards into the avatar while allowing add and withdraw changes", async () => {
    const user = userEvent.setup();
    const reveal = vi.fn();
    const seat = { ...projectedSeat(), voluntarilyRevealedCardIndices: [0] as Array<0 | 1> };
    const state = tableState({
      canRevealOwnCards: true,
      hand: projectedHand(),
      postHandReviewEndsAt: new Date(Date.now() + 4_000).toISOString(),
      runtimeStatus: "POST_HAND_REVIEW",
      seats: [seat, projectedSeat(1)],
    });
    render(<HeroHand mySeat={seat} onReveal={reveal} state={state} working={false} />);
    expect(within(screen.getByTestId("hero-avatar")).getByLabelText("A♠")).toBeInTheDocument();
    expect(within(screen.getByTestId("own-cards")).queryByLabelText("A♠")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("own-cards")).getByLabelText("K♦")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "撤回第 1 张底牌展示" }));
    expect(reveal).toHaveBeenCalledWith(0);
    await user.click(screen.getByRole("button", { name: "展示第 2 张底牌" }));
    expect(reveal).toHaveBeenLastCalledWith(1);
  });

  it("locks show-state changes throughout the four-second settlement phase", () => {
    const seat = projectedSeat();
    const state = tableState({ canRevealOwnCards: true, lastHandSummary: { handId: "30000000-0000-4000-8000-000000000001", handNumber: 1, ownNetResult: 50, voluntarilyRevealedUserIds: [], winnerUserIds: [seat.userId] }, postHandReviewEndsAt: new Date(Date.now() + 4_000).toISOString(), runtimeStatus: "POST_HAND_REVIEW", seats: [seat, projectedSeat(1)] });
    render(<PostHandReviewOverlay state={state} />);
    expect(screen.getByTestId("post-hand-review")).toHaveTextContent("+50");
    expect(screen.queryByText(/点击下方.*公开/u)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /公开两张/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/偷偷看|发发看/u)).not.toBeInTheDocument();
    expect(state.seats[0]?.stack).toBe(2_000_000_000);
  });

  it("shows the ten-second squid round transition and free-leave window", () => {
    const deadline = new Date(Date.now() + 10_000).toISOString();
    const state = tableState({ room: { ...tableState().room, specialMode: "SQUID", squidRoundGraceEndsAt: deadline, squidRoundNumber: 3, squidStake: 20 } });
    render(<PostHandReviewOverlay state={state} />);

    expect(screen.getByTestId("squid-round-transition")).toHaveTextContent("第 3 轮");
    expect(screen.getByText(/10 秒内可无惩罚站起/)).toBeInTheDocument();
    expect(screen.getByLabelText("鱿鱼标记")).toBeInTheDocument();
  });

  it("suppresses animation on initial/reconnect state and reserves the flight layer for a new deal", () => {
    const initial = projectedHand();
    const view = render(<CardAnimationCoordinator hand={initial} seatedPlayers={2} />);
    expect(screen.queryByTestId("card-animation-layer")).not.toBeInTheDocument();
    const next = projectedHand({ handId: "30000000-0000-4000-8000-000000000002" });
    view.rerender(<CardAnimationCoordinator hand={next} seatedPlayers={2} />);
    expect(screen.getByTestId("card-animation-layer")).toHaveAttribute("data-animation-kind", "deal");
    view.rerender(<CardAnimationCoordinator hand={projectedHand({ board: ["2c", "3d", "4h"], handId: next.handId })} seatedPlayers={2} />);
    expect(screen.queryByTestId("board-flight-animation")).not.toBeInTheDocument();
  });

  it("collects every pot award and pure return to its recipient with one sound per settlement batch", () => {
    const collect = vi.fn();
    const hand = projectedHand({
      actionHistory: [
        { amount: 90, eventType: "POT_AWARDED", potIndex: 0, stateVersion: 7, winners: ["user-0", "user-1"] },
        { amount: 30, eventType: "POT_AWARDED", potIndex: 1, stateVersion: 8, winners: ["user-1"] },
        { amount: 10, eventType: "UNCALLED_BET_RETURNED", playerId: "user-0", stateVersion: 9 },
      ],
    });
    const state = tableState({ hand });
    const view = render(<ChipAwardAnimation hand={hand} heroSeatIndex={0} maxSeats={state.room.maxSeats} onCollect={collect} seats={state.seats} visible={false} />);
    expect(screen.queryByTestId("chip-award-animation")).not.toBeInTheDocument();

    view.rerender(<ChipAwardAnimation hand={hand} heroSeatIndex={0} maxSeats={state.room.maxSeats} onCollect={collect} seats={state.seats} visible />);
    expect(screen.getByTestId("chip-award-animation")).toHaveAttribute("data-animation-kind", "chip-award");
    expect(screen.getAllByTestId("chip-award-flight")).toHaveLength(4);
    expect(screen.getAllByTestId("chip-award-flight").map((token) => token.dataset.winnerId)).toEqual(["user-0", "user-1", "user-1", "user-0"]);
    expect(collect).toHaveBeenCalledOnce();

    view.rerender(<ChipAwardAnimation hand={hand} heroSeatIndex={0} maxSeats={state.room.maxSeats} onCollect={collect} seats={state.seats} visible />);
    expect(collect).toHaveBeenCalledOnce();
  });

  it("lands new community cards face down and flips them face up one by one", () => {
    vi.useFakeTimers();
    try {
      const view = render(<BoardCards cards={[]} />);
      view.rerender(<BoardCards cards={["2c", "3d", "4h"]} />);
      expect(screen.getAllByTestId("board-card").every((card) => card.dataset.faceUp === "false")).toBe(true);
      act(() => vi.advanceTimersByTime(160));
      expect(screen.getAllByTestId("board-card").map((card) => card.dataset.faceUp)).toEqual(["true", "false", "false"]);
      act(() => vi.advanceTimersByTime(400));
      expect(screen.getAllByTestId("board-card").every((card) => card.dataset.faceUp === "true")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not create animation batches when reduced motion is requested", () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({ matches: true })) });
    try {
      const view = render(<CardAnimationCoordinator hand={projectedHand()} seatedPlayers={2} />);
      view.rerender(<CardAnimationCoordinator hand={projectedHand({ handId: "30000000-0000-4000-8000-000000000009" })} seatedPlayers={2} />);
      expect(screen.queryByTestId("card-animation-layer")).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
    }
  });
});
