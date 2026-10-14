import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DraggableDrawerHandle } from "./DraggableDrawerHandle.js";

describe("DraggableDrawerHandle", () => {
  beforeEach(() => window.localStorage.clear());

  it("moves vertically without opening the drawer, then preserves the position", () => {
    const onClick = vi.fn();
    const view = render(<DraggableDrawerHandle ariaLabel="打开历史" onClick={onClick} side="right" storageKey="history-handle">H</DraggableDrawerHandle>);
    const button = screen.getByRole("button", { name: "打开历史" });
    fireEvent.pointerDown(button, { clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(window, { clientY: 320, pointerId: 1 });
    fireEvent.pointerUp(window, { clientY: 320, pointerId: 1 });
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(button.style.top).not.toBe("");

    view.unmount();
    render(<DraggableDrawerHandle ariaLabel="打开历史" onClick={onClick} side="right" storageKey="history-handle">H</DraggableDrawerHandle>);
    expect(screen.getByRole("button", { name: "打开历史" }).style.top).toBe(button.style.top);
  });

  it("opens on an ordinary tap", () => {
    const onClick = vi.fn();
    render(<DraggableDrawerHandle ariaLabel="打开排名和聊天" onClick={onClick} side="left" storageKey="info-handle">I</DraggableDrawerHandle>);
    fireEvent.click(screen.getByRole("button", { name: "打开排名和聊天" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("supports the mouse-event fallback used by WebKit", () => {
    const onClick = vi.fn();
    render(<DraggableDrawerHandle ariaLabel="打开排名和聊天" onClick={onClick} side="left" storageKey="info-handle">I</DraggableDrawerHandle>);
    const button = screen.getByRole("button", { name: "打开排名和聊天" });
    fireEvent.mouseDown(button, { clientY: 200 });
    fireEvent.mouseMove(window, { clientY: 280 });
    fireEvent.mouseUp(window, { clientY: 280 });
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(button.style.top).not.toBe("");
  });

  it("does not swallow a later intentional click when no synthetic drag click occurred", async () => {
    const onClick = vi.fn();
    render(<DraggableDrawerHandle ariaLabel="打开排名和聊天" onClick={onClick} side="left" storageKey="info-handle">I</DraggableDrawerHandle>);
    const button = screen.getByRole("button", { name: "打开排名和聊天" });
    fireEvent.mouseDown(button, { clientY: 200 });
    fireEvent.mouseMove(window, { clientY: 280 });
    fireEvent.mouseUp(window, { clientY: 280 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
