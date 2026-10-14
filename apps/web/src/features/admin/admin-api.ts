import { apiRequest, postJson } from "../../api/client.js";

export interface AdminPageResult {
  readonly items: readonly Record<string, unknown>[];
  readonly nextCursor: string | null;
}

export function getAdmin<T>(path: string): Promise<T> {
  return apiRequest<T>(`/api/admin${path}`);
}

export function getAdminPage(path: string, search?: string, cursor?: string): Promise<AdminPageResult> {
  const parameters = new URLSearchParams();
  if (search) parameters.set("search", search);
  if (cursor) parameters.set("cursor", cursor);
  const query = parameters.size > 0 ? `?${parameters.toString()}` : "";
  return getAdmin<AdminPageResult>(`${path}${query}`);
}

export function searchAdminUsers(search: string, cursor?: string): Promise<AdminPageResult> {
  return postJson<AdminPageResult>("/api/admin/users/search", { ...(cursor ? { cursor } : {}), search });
}

export function adjustAdminWallet(
  userId: string,
  input: { readonly operationId: string; readonly reason: string; readonly signedAmount: number },
): Promise<Record<string, unknown>> {
  return postJson(`/api/admin/users/${encodeURIComponent(userId)}/wallet-adjustments`, input);
}

export function deleteAdminData(
  resource: "rooms" | "users",
  id: string,
  input: { readonly confirmation: "永久删除"; readonly operationId: string; readonly reason: string },
): Promise<Record<string, unknown>> {
  return postJson(`/api/admin/${resource}/${encodeURIComponent(id)}/delete`, input);
}

export function mutateAdminRoom(
  roomId: string,
  action: "close" | "pause" | "resume",
  input: { readonly operationId: string; readonly reason: string },
): Promise<Record<string, unknown>> {
  return postJson(`/api/admin/rooms/${encodeURIComponent(roomId)}/${action}`, input);
}

export function mutateAdminRecovery(
  roomId: string,
  action: "retry" | "revalidate",
  input: { readonly operationId: string; readonly reason: string },
): Promise<Record<string, unknown>> {
  return postJson(`/api/admin/recovery/${encodeURIComponent(roomId)}/${action}`, input);
}
