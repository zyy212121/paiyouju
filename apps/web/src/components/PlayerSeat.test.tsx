import { render, screen } from "@testing-library/react";
import type { ProjectedSeat } from "@paiyouju/shared";
import { describe, expect, it } from "vitest";

import { PlayerSeat } from "./PlayerSeat.js";

const seat = {
  avatarId: "avatar-03",
  committedThisStreet: 20,
  connected: false,
  hasFolded: true,
  isAllIn: true,
  isBigBlind: true,
  isCurrentActor: true,
  isDealer: true,
  isSmallBlind: true,
  nickname: "测试玩家",
  playStatus: "LEAVE_AFTER_HAND",
  publicHandLabel: null,
  reservedAwayEndsAt: null,
  seatIndex: 2,
  stack: 2_000_000_000,
  startingStack: 400,
  squidMarked: false,
  squidRoundParticipant: false,
  userId: "player-a",
  voluntarilyRevealed: false,
} satisfies ProjectedSeat;

describe("PlayerSeat", () => {
  it("uses the avatar frame for active state and renders role markers without a covered participation label", () => {
    const view = render(<PlayerSeat publicCards={["As", "Kd"]} seat={{ ...seat, connected: true, hasFolded: false, isAllIn: false, playStatus: "ACTIVE", publicHandLabel: "一对" }} winner />);

    expect(screen.getByText("D")).toBeInTheDocument();
    expect(screen.getByText("SB")).toBeInTheDocument();
    expect(screen.getByText("BB")).toBeInTheDocument();
    expect(screen.queryByText("行动中")).not.toBeInTheDocument();
    expect(screen.getByText("赢家")).toBeInTheDocument();
    expect(screen.queryByText("参与中")).not.toBeInTheDocument();
    expect(screen.getByLabelText("玩家状态：参与中")).toBeInTheDocument();
    expect(view.container.querySelector('[data-player-visual-state="active"]')).toBeInTheDocument();
    expect(view.container.querySelector('[data-avatar-id="avatar-03"]')).toBeInTheDocument();
    expect(screen.queryByText("测")).not.toBeInTheDocument();
    expect(screen.getByText("2,000,000,000")).toBeInTheDocument();
    expect(screen.getByLabelText("A♠")).toBeInTheDocument();
    expect(screen.getByLabelText("K♦")).toBeInTheDocument();
    expect(screen.getByText("一对")).toBeInTheDocument();
  });

  it("renders folded seats in a dimmed visual state and stood seats as a black avatar with 站", () => {
    const view = render(<PlayerSeat publicCards={[]} seat={{ ...seat, connected: true, hasFolded: true, isAllIn: false, isBigBlind: false, isCurrentActor: false, isDealer: false, isSmallBlind: false, playStatus: "ACTIVE" }} winner={false} />);
    expect(view.container.querySelector('[data-player-visual-state="folded"]')).toBeInTheDocument();

    view.rerender(<PlayerSeat publicCards={[]} seat={{ ...seat, connected: true, hasFolded: false, isAllIn: false, isBigBlind: false, isCurrentActor: false, isDealer: false, isSmallBlind: false, playStatus: "SIT_OUT" }} winner={false} />);
    expect(screen.getByLabelText("玩家状态：已暂停")).toBeInTheDocument();
    expect(view.container.querySelector('[data-player-visual-state="standing"]')).toBeInTheDocument();
    expect(screen.getByText("站")).toBeInTheDocument();
  });

  it("pairs street commitment with a visible chip instead of plain 投入 text", () => {
    render(<PlayerSeat publicCards={[]} seat={{ ...seat, connected: true, hasFolded: false, isAllIn: false, isCurrentActor: false, playStatus: "ACTIVE" }} winner={false} />);
    expect(screen.getByLabelText("本街投入 20")).toBeInTheDocument();
    expect(screen.getByTestId("street-commitment-chip")).toBeInTheDocument();
    expect(screen.queryByText("投入 20")).not.toBeInTheDocument();
  });

  it("shows the squid marker beside the normal seat markers", () => {
    render(<PlayerSeat publicCards={[]} seat={{ ...seat, connected: true, hasFolded: false, isCurrentActor: false, playStatus: "ACTIVE", squidMarked: true }} winner={false} />);

    expect(screen.getByLabelText("鱿鱼标记")).toBeInTheDocument();
  });

  it("keeps hidden card codes out of the DOM and reserves Eye for voluntary public cards", () => {
    const hidden = render(<PlayerSeat hasHand publicCards={[]} seat={{ ...seat, connected: true, hasFolded: false, isCurrentActor: false, voluntarilyRevealed: false }} winner={false} />);
    expect(screen.getByLabelText("对手底牌未公开")).toBeInTheDocument();
    expect(hidden.container.querySelector("[data-card-code]")).toBeNull();
    expect(hidden.container.innerHTML).not.toMatch(/As|Kd/u);
    hidden.rerender(<PlayerSeat hasHand publicCards={["As", "Kd"]} seat={{ ...seat, connected: true, hasFolded: false, isCurrentActor: false, voluntarilyRevealed: true }} winner={false} />);
    expect(screen.getByLabelText("第 1 张主动公开底牌")).toBeInTheDocument();
    expect(screen.getByLabelText("第 2 张主动公开底牌")).toBeInTheDocument();
  });

  it("keeps card backs on a deferred standing player who is still in the hand", () => {
    const view = render(<PlayerSeat hasHand publicCards={[]} seat={{ ...seat, connected: true, hasFolded: false, isAllIn: false, isCurrentActor: false, playStatus: "LEAVE_AFTER_HAND" }} winner={false} />);

    expect(view.container.querySelector('[data-player-visual-state="standing"]')).toBeInTheDocument();
    expect(screen.getByText("站")).toBeInTheDocument();
    expect(screen.getByLabelText("对手底牌未公开")).toBeInTheDocument();
  });

  it("replaces the nickname with the latest street action status", () => {
    render(<PlayerSeat actionLabel="全下" publicCards={[]} seat={{ ...seat, connected: true, hasFolded: false, isAllIn: true, isCurrentActor: false, playStatus: "ACTIVE" }} winner={false} />);

    expect(screen.getByText("全下")).toHaveClass("seat-action-label");
    expect(screen.queryByText("测试玩家")).not.toBeInTheDocument();
  });

  it("does not apply the folded grayscale treatment to publicly shown cards", () => {
    const view = render(<PlayerSeat hasHand publicCards={["As", "Kd"]} seat={{ ...seat, connected: true, hasFolded: true, isAllIn: false, isCurrentActor: false, playStatus: "ACTIVE", voluntarilyRevealed: true }} winner={false} />);

    expect(view.container.querySelector('.seat-visual-folded.has-public-cards')).toBeInTheDocument();
    expect(screen.getByLabelText("A♠")).toBeInTheDocument();
    expect(screen.getByLabelText("K♦")).toBeInTheDocument();
  });
});
