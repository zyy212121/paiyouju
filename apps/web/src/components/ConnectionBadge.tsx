export function ConnectionBadge({ status }: { readonly status: "connected" | "reconnecting" | "disconnected" }) {
  const label = status === "connected" ? "已连接" : status === "reconnecting" ? "正在重连" : "已断开";
  const color = status === "connected" ? "bg-emerald-400" : status === "reconnecting" ? "bg-amber-300" : "bg-rose-400";
  return <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-stone-200"><span className={`size-2 rounded-full ${color}`} />{label}</span>;
}
