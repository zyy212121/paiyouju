export function ConnectionBanner({ status }: { readonly status: "connected" | "reconnecting" | "disconnected" }) {
  if (status === "connected") return null;
  return <div className="connection-banner" role="status">{status === "reconnecting" ? "正在重连，操作已暂停…" : "网络已断开，服务器计时仍会继续"}</div>;
}
