import type { GameSessionDetail, GameSessionSummary } from "@paiyouju/shared";

import { apiRequest } from "./client.js";

export interface CursorPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export function listGames(input: { readonly cursor?: string; readonly limit?: number; readonly roomId?: string; readonly signal?: AbortSignal; readonly status?: "ACTIVE" | "CLOSED" } = {}) {
  const query = new URLSearchParams();
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.limit) query.set("limit", String(input.limit));
  if (input.roomId) query.set("roomId", input.roomId);
  if (input.status) query.set("status", input.status);
  return apiRequest<CursorPage<GameSessionSummary>>(`/api/games?${query}`, input.signal ? { signal: input.signal } : {});
}

export const getGame = (gameSessionId: string, signal?: AbortSignal) =>
  apiRequest<GameSessionDetail>(`/api/games/${encodeURIComponent(gameSessionId)}`, signal ? { signal } : {});
