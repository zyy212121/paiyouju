import type { TableRanking } from "@paiyouju/shared";

import { apiRequest } from "./client.js";

export const getTableRankings = (roomId: string, signal?: AbortSignal) => apiRequest<TableRanking>(
  `/api/rooms/${encodeURIComponent(roomId)}/rankings`,
  signal ? { signal } : {},
);
