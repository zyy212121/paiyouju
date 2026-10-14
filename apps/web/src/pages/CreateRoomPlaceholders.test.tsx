import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { CreateRoomPage } from "./CreateRoomPage.js";

describe("CreateRoomPage game modes", () => {
  it("makes run-it-twice, squid, short deck and bomb pot mutually exclusive", () => {
    render(<MemoryRouter><CreateRoomPage /></MemoryRouter>);
    const runTwice = screen.getByRole("checkbox", { name: "All-in 后发两次" });
    expect(runTwice).toBeEnabled();
    expect(screen.queryByText("低水保险")).not.toBeInTheDocument();

    fireEvent.click(runTwice);
    expect(runTwice).toBeChecked();

    fireEvent.click(screen.getByRole("checkbox", { name: "鱿鱼模式" }));
    expect(runTwice).not.toBeChecked();
    expect(runTwice).toBeDisabled();
    const squidStake = screen.getByRole("slider", { name: "鱿鱼每人支付" });
    expect(squidStake).toHaveValue("1");
    expect(squidStake).toHaveAttribute("min", "1");
    expect(squidStake).toHaveAttribute("max", "5");
    expect(squidStake).toHaveAttribute("step", "1");
    expect(screen.getByText("20 点 / 人")).toBeInTheDocument();
    fireEvent.change(squidStake, { target: { value: "4" } });
    expect(screen.getByText("80 点 / 人")).toBeInTheDocument();

    const shortDeck = screen.getByRole("checkbox", { name: "短牌模式" });
    fireEvent.click(shortDeck);
    expect(shortDeck).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "鱿鱼模式" })).not.toBeChecked();
    expect(runTwice).toBeDisabled();
    expect(screen.queryByRole("slider", { name: "鱿鱼每人支付" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("初始带入")).not.toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "短牌后手下限" })).toHaveValue("500");
    expect(screen.getByRole("slider", { name: "短牌后手上限" })).toHaveValue("2000");

    fireEvent.click(runTwice);
    expect(runTwice).toBeDisabled();

    const bombPot = screen.getByRole("checkbox", { name: "暴击模式" });
    fireEvent.click(bombPot);
    expect(bombPot).toBeChecked();
    expect(shortDeck).not.toBeChecked();
    expect(runTwice).toBeDisabled();
    const bombInterval = screen.getByRole("slider", { name: "暴击频率" });
    expect(bombInterval).toHaveValue("2");
    expect(bombInterval).toHaveAttribute("aria-valuetext", "10 分钟");
    expect(bombInterval).toHaveAttribute("min", "0");
    expect(bombInterval).toHaveAttribute("max", "6");
    expect(bombInterval).toHaveAttribute("step", "1");
    expect(screen.getByRole("slider", { name: "暴击盲注" })).toHaveValue("3");
    expect(screen.getByText("每 10 分钟")).toBeInTheDocument();
    fireEvent.change(bombInterval, { target: { value: "0" } });
    expect(screen.getByText("每 1 分钟")).toBeInTheDocument();
    expect(screen.getByText("3 BB（60 点）")).toBeInTheDocument();
  });

  it("uses stepped sliders for room duration and action time without fee configuration", () => {
    render(<MemoryRouter><CreateRoomPage /></MemoryRouter>);
    const duration = screen.getByRole("slider", { name: "房间时长" });
    const action = screen.getByRole("slider", { name: "行动时间" });
    expect(duration).toHaveValue("60");
    expect(duration).toHaveAttribute("min", "30");
    expect(duration).toHaveAttribute("max", "180");
    expect(duration).toHaveAttribute("step", "30");
    expect(action).toHaveValue("30");
    expect(action).toHaveAttribute("min", "10");
    expect(action).toHaveAttribute("max", "45");
    expect(action).toHaveAttribute("step", "5");
    fireEvent.change(action, { target: { value: "45" } });
    expect(screen.getByText("45 秒")).toBeInTheDocument();
    expect(screen.queryByText(/积分看牌费用|开启整手积分看牌/u)).not.toBeInTheDocument();
  });

  it("sets only the big blind with presets or a manual integer and derives the small blind", () => {
    render(<MemoryRouter><CreateRoomPage /></MemoryRouter>);
    const presets = screen.getByRole("slider", { name: "大盲快捷档位" });
    const manual = screen.getByRole("spinbutton", { name: "大盲手动输入" });

    expect(screen.queryByLabelText("Small Blind")).not.toBeInTheDocument();
    expect(presets).toHaveValue("20");
    expect(presets).toHaveAttribute("min", "10");
    expect(presets).toHaveAttribute("max", "50");
    expect(presets).toHaveAttribute("step", "10");
    expect(manual).toHaveValue(20);
    expect(manual).toHaveAttribute("name", "bigBlind");
    expect(screen.getByText("小盲自动 10 点")).toBeInTheDocument();

    fireEvent.change(presets, { target: { value: "50" } });
    expect(manual).toHaveValue(50);
    expect(screen.getByText("小盲自动 25 点")).toBeInTheDocument();

    fireEvent.change(manual, { target: { value: "37" } });
    expect(manual).toHaveValue(37);
    expect(screen.getByText("小盲自动 19 点")).toBeInTheDocument();
  });
});
