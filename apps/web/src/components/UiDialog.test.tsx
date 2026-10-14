import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { UiDialog } from "./UiDialog.js";

describe("UiDialog", () => {
  it("renders an in-app confirmation dialog and returns confirmation without using browser dialogs", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<UiDialog description="进行中的手牌会先完成结算。" onCancel={vi.fn()} onConfirm={onConfirm} open title="安全关闭房间" />);

    expect(screen.getByRole("dialog", { name: "安全关闭房间" })).toHaveClass("ui-dialog-card");
    await user.click(screen.getByRole("button", { name: "确认" }));
    expect(onConfirm).toHaveBeenCalledWith({});
  });

  it("validates audit and typed-confirmation fields inside the themed dialog", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<UiDialog
      confirmLabel="永久删除"
      danger
      fields={[
        { id: "reason", label: "删除原因", minLength: 8 },
        { expectedValue: "永久删除", id: "confirmation", label: "输入“永久删除”" },
      ]}
      onCancel={vi.fn()}
      onConfirm={onConfirm}
      open
      title="删除玩家资料"
    />);

    const submit = screen.getByRole("button", { name: "永久删除" });
    expect(submit).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "删除原因" }), "测试数据已经确认");
    await user.type(screen.getByLabelText("输入“永久删除”"), "永久删除");
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(onConfirm).toHaveBeenCalledWith({ confirmation: "永久删除", reason: "测试数据已经确认" });
  });

  it("closes on Escape while idle", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<UiDialog onCancel={onCancel} onConfirm={vi.fn()} open title="离开牌桌" />);
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
