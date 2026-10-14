import { describe, expect, it } from "vitest";

import {
  AdminDestructiveActionSchema,
  AdminListQuerySchema,
  AdminRoomActionSchema,
  AdminWalletAdjustmentSchema,
} from "./admin.schemas.js";

const operationId = "11111111-1111-4111-8111-111111111111";

describe("administrator input schemas", () => {
  it("requires an explicit confirmation phrase for destructive deletion", () => {
    expect(AdminDestructiveActionSchema.parse({
      confirmation: "永久删除",
      operationId,
      reason: "清理本轮测试产生的数据",
    })).toEqual({ confirmation: "永久删除", operationId, reason: "清理本轮测试产生的数据" });
    expect(AdminDestructiveActionSchema.safeParse({
      confirmation: "确认",
      operationId,
      reason: "清理本轮测试产生的数据",
    }).success).toBe(false);
  });

  it("accepts a bounded signed adjustment with a plain-text reason", () => {
    expect(AdminWalletAdjustmentSchema.parse({
      operationId,
      reason: "封闭测试期间核对积分",
      signedAmount: -100,
    })).toEqual({ operationId, reason: "封闭测试期间核对积分", signedAmount: -100 });
  });

  it.each([
    { operationId, reason: "理由太短", signedAmount: 1 },
    { operationId, reason: "包含 <b>HTML</b> 不允许", signedAmount: 1 },
    { operationId, reason: "包含\u0000控制字符不允许", signedAmount: 1 },
    { operationId, reason: "封闭测试期间核对积分", signedAmount: 0 },
    { operationId: "not-a-uuid", reason: "封闭测试期间核对积分", signedAmount: 1 },
    { extra: true, operationId, reason: "封闭测试期间核对积分", signedAmount: 1 },
  ])("rejects an unsafe adjustment %#", (input) => {
    expect(AdminWalletAdjustmentSchema.safeParse(input).success).toBe(false);
  });

  it("normalizes bounded list and room-action inputs", () => {
    expect(AdminListQuerySchema.parse({ limit: "25", search: "  爱丽丝  " })).toEqual({ limit: 25, search: "爱丽丝" });
    expect(AdminRoomActionSchema.parse({ operationId, reason: "房间异常，需要安全暂停" })).toEqual({ operationId, reason: "房间异常，需要安全暂停" });
    expect(AdminListQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });
});
