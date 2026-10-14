import type { AvatarId } from "@paiyouju/shared";

import { useNetworkStore } from "../stores/network-store.js";

export interface PublicUser {
  readonly avatarId: AvatarId;
  readonly createdAt: string;
  readonly id: string;
  readonly hasPhoneNumber: boolean;
  readonly nickname: string;
  readonly phoneMasked: string | null;
  readonly role: "USER" | "ADMIN";
  readonly username: string;
  readonly walletBalance: number;
}

export interface WalletSummary {
  readonly balance: number;
  readonly updatedAt: string;
  readonly version: number;
}

export interface RoomMember {
  readonly joinedAt: string;
  readonly role: "OWNER" | "MEMBER";
  readonly user: Pick<PublicUser, "id" | "nickname" | "username">;
}

export interface PublicRoom {
  readonly archivedAt: string | null;
  readonly actionTimeSeconds: number;
  readonly bigBlind: number;
  readonly bombPotBlindMultiplier?: number | null;
  readonly bombPotIntervalMinutes?: number | null;
  readonly bombPotNextAt?: string | null;
  readonly closeRequestedAt: string | null;
  readonly closedAt: string | null;
  readonly createdAt: string;
  readonly durationMinutes: number;
  readonly expiresAt: string;
  readonly hasPassword: boolean;
  readonly id: string;
  readonly initialBuyIn: number;
  readonly maximumBuyIn: number;
  readonly maxSeats: number;
  readonly memberRole: "OWNER" | "MEMBER";
  readonly members: readonly RoomMember[];
  readonly minimumBuyIn: number;
  readonly name: string;
  readonly nextHandPaused: boolean;
  readonly ownerId: string;
  readonly paidCardRevealCost: number;
  readonly paidCardRevealEnabled: boolean;
  readonly requiresManualStart: boolean;
  readonly runItTwiceEnabled: boolean;
  readonly roomCode: string;
  readonly smallBlind: number;
  readonly specialMode: "NORMAL" | "SQUID" | "SHORT_DECK" | "BOMB_POT";
  readonly squidStake: number | null;
  readonly squidRoundGraceEndsAt: string | null;
  readonly squidRoundNumber: number;
  readonly status: "OPEN" | "CLOSING" | "CLOSED";
  readonly tableStartedAt: string | null;
  readonly updatedAt: string;
}

export interface CreateRoomInput {
  readonly actionTimeSeconds: number;
  readonly bigBlind: number;
  readonly bombPotBlindMultiplier?: number;
  readonly bombPotIntervalMinutes?: number;
  readonly durationMinutes: number;
  readonly initialBuyIn?: number;
  readonly maximumBuyIn?: number;
  readonly maxSeats: number;
  readonly name: string;
  readonly password?: string;
  readonly runItTwiceEnabled: boolean;
  readonly specialMode: "NORMAL" | "SQUID" | "SHORT_DECK" | "BOMB_POT";
  readonly minimumBuyIn?: number;
  readonly squidStake?: number;
}

export class HttpApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "HttpApiError";
  }
}

interface ErrorEnvelope {
  readonly error?: {
    readonly code?: unknown;
    readonly message?: unknown;
    readonly requestId?: unknown;
  };
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const write = method !== "GET" && method !== "HEAD";
  if (write && typeof navigator !== "undefined" && !navigator.onLine) {
    throw new HttpApiError("OFFLINE", "当前离线，写操作未发送");
  }
  if (write) useNetworkStore.getState().beginWrite();
  const timeout = new AbortController();
  const timer = window.setTimeout(() => timeout.abort("timeout"), 15_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout.signal]) : timeout.signal;
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (write) headers.set("x-wepoker-request", "1");
  try {
    const response = await fetch(path, {
      ...init,
      cache: "no-store",
      credentials: "include",
      headers,
      signal,
    });
    const body = await response.json().catch(() => ({})) as { readonly data?: T } & ErrorEnvelope;
    if (!response.ok || body.data === undefined) {
      const error = body.error;
      throw new HttpApiError(
        typeof error?.code === "string" ? error.code : "REQUEST_FAILED",
        typeof error?.message === "string" ? error.message : "请求失败，请稍后重试",
        typeof error?.requestId === "string" ? error.requestId : undefined,
      );
    }
    return body.data;
  } catch (error: unknown) {
    if (error instanceof HttpApiError) throw error;
    if (signal.aborted) throw new HttpApiError("REQUEST_TIMEOUT", "请求超时，请确认网络后重试");
    throw new HttpApiError("NETWORK_ERROR", "网络连接失败，请稍后重试");
  } finally {
    window.clearTimeout(timer);
    if (write) useNetworkStore.getState().endWrite();
  }
}

export const postJson = <T>(path: string, body?: unknown, headers?: HeadersInit) =>
  apiRequest<T>(path, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(headers === undefined ? {} : { headers }),
    method: "POST",
  });

export const patchJson = <T>(path: string, body: unknown) => apiRequest<T>(path, {
  body: JSON.stringify(body),
  method: "PATCH",
});

const errorMessages: Readonly<Record<string, string>> = {
  AUTH_REQUIRED: "登录状态已失效，请重新登录",
  CARD_ALREADY_PUBLIC: "这位玩家的底牌已经公开，无需付费",
  HAND_ACCESS_DENIED: "无权查看这手牌",
  HAND_NOT_FOUND: "历史牌局不存在",
  IDEMPOTENCY_CONFLICT: "该操作编号已用于另一项请求，请刷新后重试",
  INSUFFICIENT_WALLET_BALANCE: "钻石不足",
  NETWORK_ERROR: "网络连接失败，请稍后重试",
  OFFLINE: "当前离线，写操作已暂停",
  ORIGIN_NOT_ALLOWED: "访问地址与服务器配置不一致，请使用启动终端显示的牌友局网址重新打开",
  PAID_REVEAL_DISABLED: "这手牌未开启偷偷看",
  REPLAY_NOT_AVAILABLE: "此历史牌局没有完整回放数据",
  REQUEST_TIMEOUT: "请求结果暂不确定，请使用原操作编号重试",
  TARGET_IS_SELF: "自己的底牌无需付费查看",
  TARGET_NOT_IN_HAND: "目标玩家不在这手牌中",
};

export function readableError(error: unknown): string {
  if (error instanceof HttpApiError) return errorMessages[error.code] ?? error.message;
  return "操作失败，请稍后重试";
}

export function createOperationId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
