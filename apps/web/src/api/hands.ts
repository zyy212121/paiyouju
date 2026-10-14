import type {
  HandDetail,
  HandReplay,
  HandSummary,
  HypotheticalRunoutPurchaseResult,
  PaidCardRevealResult,
  PaidHandRevealResult,
} from "@paiyouju/shared";

import { apiRequest, postJson } from "./client.js";
import type { CursorPage } from "./games.js";

export function listHands(input: {
  readonly cursor?: string;
  readonly finishedFrom?: string;
  readonly finishedTo?: string;
  readonly limit?: number;
  readonly result?: "win" | "loss" | "break-even";
  readonly roomId?: string;
  readonly signal?: AbortSignal;
} = {}) {
  const query = new URLSearchParams();
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.finishedFrom) query.set("finishedFrom", input.finishedFrom);
  if (input.finishedTo) query.set("finishedTo", input.finishedTo);
  if (input.limit) query.set("limit", String(input.limit));
  if (input.result) query.set("result", input.result);
  if (input.roomId) query.set("roomId", input.roomId);
  return apiRequest<CursorPage<HandSummary>>(`/api/hands?${query}`, input.signal ? { signal: input.signal } : {});
}

export const getHand = (handId: string, runoutIndex: 1 | 2 | null = null, signal?: AbortSignal) => {
  const query = runoutIndex === null ? "" : `?runoutIndex=${runoutIndex}`;
  return apiRequest<HandDetail>(`/api/hands/${encodeURIComponent(handId)}${query}`, signal ? { signal } : {});
};
export const getReplay = (handId: string, signal?: AbortSignal) =>
  apiRequest<HandReplay>(`/api/hands/${encodeURIComponent(handId)}/replay`, signal ? { signal } : {});
export const buyPaidReveal = (handId: string, input: { readonly operationId: string; readonly targetUserId: string }) =>
  postJson<PaidCardRevealResult>(`/api/hands/${encodeURIComponent(handId)}/paid-reveals`, input);

export const buyPaidHandReveal = (handId: string, input: { readonly operationId: string }) =>
  postJson<PaidHandRevealResult>(`/api/hands/${encodeURIComponent(handId)}/paid-hand-reveal`, input);

export const generateHypotheticalRunout = (handId: string, input: { readonly operationId: string }) =>
  postJson<HypotheticalRunoutPurchaseResult>(`/api/hands/${encodeURIComponent(handId)}/hypothetical-runout`, input);
