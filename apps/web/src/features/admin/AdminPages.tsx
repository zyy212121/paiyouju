import { AlertTriangle, CheckCircle2, ChevronRight, RefreshCw, Search, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { createOperationId, readableError } from "../../api/client.js";
import { UiDialog } from "../../components/UiDialog.js";
import {
  adjustAdminWallet,
  deleteAdminData,
  getAdmin,
  getAdminPage,
  mutateAdminRecovery,
  mutateAdminRoom,
  searchAdminUsers,
  type AdminPageResult,
} from "./admin-api.js";

type JsonRecord = Record<string, unknown>;

const dashboardLabels: Readonly<Record<string, string>> = {
  actionExtensions24h: "24 小时加时",
  activeRuntimes: "活动 Runtime",
  activeSockets: "活动 Socket",
  activeTables: "活动牌桌",
  activeUsers24h: "24 小时活跃用户",
  archivedRooms: "已归档房间",
  bustedWaitingRebuy: "等待补充筹码",
  closedRooms: "CLOSED 房间",
  closingRooms: "CLOSING 房间",
  handsCompleted24h: "24 小时完成手牌",
  handsInProgress: "进行中手牌",
  hypotheticalRunouts24h: "24 小时发发看",
  onlineUsers: "在线用户",
  openRooms: "OPEN 房间",
  paidReveals24h: "24 小时偷偷看",
  postHandReview: "结算展示阶段",
  recoveryErrorRooms: "RECOVERY_ERROR",
  reservedAway: "暂离保留",
  tableStackTotal: "桌面筹码总额",
  usersTotal: "用户总数",
  walletTotalBalance: "Wallet 总余额",
};

function asRecord(value: unknown): JsonRecord {
  return value !== null && !Array.isArray(value) && typeof value === "object" ? value as JsonRecord : {};
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "string") {
    const timestamp = Date.parse(value);
    return /T\d{2}:\d{2}/u.test(value) && Number.isFinite(timestamp)
      ? new Date(timestamp).toLocaleString()
      : value;
  }
  return JSON.stringify(value);
}

function ErrorNotice({ error }: { readonly error: string | null }) {
  return error ? <p className="flex items-center gap-2 rounded-xl border border-red-300/20 bg-red-950/40 p-3 text-sm text-red-100"><AlertTriangle size={16} />{error}</p> : null;
}

function PageHeading({ title, description }: { readonly description?: string; readonly title: string }) {
  return <header className="mb-5"><h1 className="text-2xl font-semibold">{title}</h1>{description ? <p className="mt-1 text-sm text-stone-400">{description}</p> : null}</header>;
}

export function AdminDashboardPage() {
  const [data, setData] = useState<JsonRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setData(await getAdmin<JsonRecord>("/dashboard")); setError(null); }
    catch (caught) { setError(readableError(caught)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <div>
      <PageHeading description="数据库权威统计；不下载全量记录到浏览器。" title="管理概览" />
      <ErrorNotice error={error} />
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Object.entries(data ?? {}).filter(([key]) => key in dashboardLabels).map(([key, value]) => (
          <article className="rounded-xl border border-white/10 bg-white/[0.04] p-4" key={key}>
            <p className="text-xs text-stone-400">{dashboardLabels[key]}</p>
            <p className="mt-2 text-xl font-semibold text-amber-100">{formatValue(value)}</p>
          </article>
        ))}
      </div>
      <button className="secondary-button mt-5 inline-flex items-center gap-2" onClick={() => void load()} type="button"><RefreshCw size={15} />刷新</button>
    </div>
  );
}

interface AdminResourcePageProps {
  readonly detailBase?: string;
  readonly description?: string;
  readonly endpoint: string;
  readonly title: string;
}

export function AdminResourcePage({ detailBase, description, endpoint, title }: AdminResourcePageProps) {
  const [page, setPage] = useState<AdminPageResult>({ items: [], nextCursor: null });
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (cursor?: string) => {
    try {
      const result = endpoint === "/users" && /^\d{11}$/u.test(activeSearch)
        ? await searchAdminUsers(activeSearch, cursor)
        : await getAdminPage(endpoint, activeSearch || undefined, cursor);
      setPage(result);
      setError(null);
    } catch (caught) { setError(readableError(caught)); }
  }, [activeSearch, endpoint]);
  useEffect(() => { void load(); }, [load]);
  const columns = useMemo(() => {
    const preferred = ["id", "roomCode", "nickname", "username", "phoneMasked", "role", "status", "runtimeStatus", "actionType", "cost", "validationStatus", "createdAt"];
    const keys = new Set(page.items.flatMap((item) => Object.keys(item)));
    return [...preferred.filter((key) => keys.has(key)), ...[...keys].filter((key) => !preferred.includes(key))].slice(0, 10);
  }, [page.items]);
  const submit = (event: FormEvent) => { event.preventDefault(); setActiveSearch(search.trim()); };
  return (
    <div>
      <PageHeading {...(description === undefined ? {} : { description })} title={title} />
      <form className="mb-4 flex gap-2" onSubmit={submit}>
        <label className="relative min-w-0 flex-1"><span className="sr-only">搜索</span><Search className="pointer-events-none absolute left-3 top-3.5 text-stone-500" size={17} /><input className="field pl-9" onChange={(event) => setSearch(event.target.value)} placeholder="ID、名称、用户名或手机号后四位" value={search} /></label>
        <button className="secondary-button" type="submit">搜索</button>
      </form>
      <ErrorNotice error={error} />
      <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-white/[0.06] text-stone-300"><tr>{columns.map((column) => <th className="whitespace-nowrap px-3 py-2 font-medium" key={column}>{column}</th>)}{detailBase ? <th className="px-3 py-2">详情</th> : null}</tr></thead>
          <tbody>{page.items.map((item, index) => <tr className="border-t border-white/5 align-top" key={String(item.id ?? index)}>{columns.map((column) => <td className="max-w-72 break-words px-3 py-2 text-stone-200" key={column}>{formatValue(item[column])}</td>)}{detailBase && typeof item.id === "string" ? <td className="px-3 py-2"><Link aria-label={`查看 ${item.id}`} className="text-amber-200" to={`${detailBase}/${encodeURIComponent(item.id)}`}><ChevronRight size={16} /></Link></td> : null}</tr>)}</tbody>
        </table>
        {page.items.length === 0 ? <p className="p-6 text-center text-sm text-stone-500">暂无记录</p> : null}
      </div>
      {page.nextCursor ? <button className="secondary-button mt-4" onClick={() => void load(page.nextCursor ?? undefined)} type="button">下一页</button> : null}
    </div>
  );
}

function DetailGrid({ data }: { readonly data: JsonRecord }) {
  return <dl className="grid gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 sm:grid-cols-2">{Object.entries(data).map(([key, value]) => <div className="min-w-0 bg-[#071a18] p-3" key={key}><dt className="text-xs text-stone-500">{key}</dt><dd className="mt-1 break-words text-sm text-stone-200">{formatValue(value)}</dd></div>)}</dl>;
}

export function AdminDetailPage({ endpoint, title }: { readonly endpoint: string; readonly title: string }) {
  const parameters = useParams();
  const id = parameters.userId ?? parameters.roomId ?? parameters.gameSessionId ?? parameters.handId ?? "";
  const [data, setData] = useState<JsonRecord>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void getAdmin<JsonRecord>(`${endpoint}${id ? `/${encodeURIComponent(id)}` : ""}`).then(setData).catch((caught) => setError(readableError(caught))); }, [endpoint, id]);
  return <div><PageHeading title={title} /><ErrorNotice error={error} /><DetailGrid data={data} /></div>;
}

export function AdminUserDetailPage() {
  const { userId = "" } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<JsonRecord>({});
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"wallet" | "delete" | null>(null);
  const [working, setWorking] = useState(false);
  const load = useCallback(async () => { try { setData(await getAdmin<JsonRecord>(`/users/${encodeURIComponent(userId)}`)); setError(null); } catch (caught) { setError(readableError(caught)); } }, [userId]);
  useEffect(() => { void load(); }, [load]);
  const wallet = asRecord(data.wallet);
  const current = typeof wallet.balance === "number" ? wallet.balance : 0;
  const signedAmount = Number(amount);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!Number.isSafeInteger(signedAmount) || signedAmount === 0 || reason.trim().length < 8) { setError("请输入非零整数和至少 8 个字符的原因"); return; }
    setDialog("wallet");
  };
  const confirmWalletAdjustment = async () => {
    setWorking(true);
    try {
      await adjustAdminWallet(userId, { operationId: createOperationId(), reason: reason.trim(), signedAmount });
      setAmount(""); setReason(""); setMessage("钻石调整已提交并写入审计日志"); setError(null); setDialog(null); await load();
    } catch (caught) { setError(readableError(caught)); }
    finally { setWorking(false); }
  };
  const deleteUser = async (values: Readonly<Record<string, string>>) => {
    setWorking(true);
    try {
      await deleteAdminData("users", userId, { confirmation: "永久删除", operationId: createOperationId(), reason: values.reason ?? "" });
      navigate("/admin/users", { replace: true });
    } catch (caught) { setError(readableError(caught)); }
    finally { setWorking(false); }
  };
  return (
    <div>
      <PageHeading description="余额只可通过 ADMIN_ADJUSTMENT、Ledger 和 AuditLog 事务修改。" title="用户详情" />
      <ErrorNotice error={error} />
      {message ? <p className="mb-4 flex items-center gap-2 text-sm text-emerald-200"><CheckCircle2 size={16} />{message}</p> : null}
      <DetailGrid data={data} />
      <form className="mt-5 rounded-xl border border-amber-300/20 bg-amber-950/10 p-4" onSubmit={(event) => void submit(event)}>
        <h2 className="font-semibold text-amber-100">管理员钻石调整</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3"><label className="text-sm">当前余额<input className="field mt-1" disabled value={current} /></label><label className="text-sm">调整金额<input className="field mt-1" inputMode="numeric" onChange={(event) => setAmount(event.target.value)} value={amount} /></label><label className="text-sm">调整后余额<input className="field mt-1" disabled value={Number.isFinite(signedAmount) ? current + signedAmount : current} /></label></div>
        <label className="mt-3 block text-sm">原因<input className="field mt-1" maxLength={200} minLength={8} onChange={(event) => setReason(event.target.value)} required value={reason} /></label>
        <button className="primary-button mt-3" type="submit">复核并提交</button>
      </form>
      {data.role !== "ADMIN" ? <section className="mt-5 rounded-xl border border-rose-400/25 bg-rose-950/10 p-4"><h2 className="font-semibold text-rose-100">删除玩家资料</h2><p className="mt-2 text-sm text-stone-400">玩家仍有关联房间时必须先删除相应房间数据。</p><button className="danger-button mt-3" onClick={() => setDialog("delete")} type="button">永久删除玩家资料</button></section> : null}
      <UiDialog busy={working} description={`确认调整 ${String(data.nickname ?? userId)}：${current.toLocaleString()} → ${(current + signedAmount).toLocaleString()}。`} onCancel={() => setDialog(null)} onConfirm={confirmWalletAdjustment} open={dialog === "wallet"} title="确认钻石调整" />
      <UiDialog busy={working} confirmLabel="永久删除" danger description="此操作不可撤销；玩家仍有关联房间时会被服务器拒绝。" fields={[{ id: "reason", label: "删除原因", minLength: 8 }, { expectedValue: "永久删除", id: "confirmation", label: "输入“永久删除”" }]} onCancel={() => setDialog(null)} onConfirm={deleteUser} open={dialog === "delete"} title="删除玩家资料" />
    </div>
  );
}

export function AdminRoomDetailPage() {
  const { roomId = "" } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<JsonRecord>({});
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ readonly action: "close" | "pause" | "resume"; readonly kind: "action" } | { readonly kind: "delete" } | null>(null);
  const [working, setWorking] = useState(false);
  const load = useCallback(async () => { try { setData(await getAdmin<JsonRecord>(`/rooms/${encodeURIComponent(roomId)}`)); setError(null); } catch (caught) { setError(readableError(caught)); } }, [roomId]);
  useEffect(() => { void load(); }, [load]);
  const confirmDialog = async (values: Readonly<Record<string, string>>) => {
    const pending = dialog;
    if (!pending) return;
    setWorking(true);
    try {
      if (pending.kind === "action") await mutateAdminRoom(roomId, pending.action, { operationId: createOperationId(), reason: values.reason ?? "" });
      else {
        await deleteAdminData("rooms", roomId, { confirmation: "永久删除", operationId: createOperationId(), reason: values.reason ?? "" });
        navigate("/admin/rooms", { replace: true });
        return;
      }
      setDialog(null);
      await load();
    }
    catch (caught) { setError(readableError(caught)); }
    finally { setWorking(false); }
  };
  const actionName = dialog?.kind === "action" ? ({ close: "安全关闭", pause: "暂停下一手", resume: "恢复下一手" } as const)[dialog.action] : "";
  return <div><PageHeading description="只提供暂停下一手、恢复下一手和安全关闭。" title="房间详情" /><ErrorNotice error={error} /><DetailGrid data={data} /><div className="mt-4 flex flex-wrap gap-2"><button className="secondary-button" onClick={() => setDialog({ action: "pause", kind: "action" })} type="button">暂停下一手</button><button className="secondary-button" onClick={() => setDialog({ action: "resume", kind: "action" })} type="button">恢复下一手</button><button className="danger-button" onClick={() => setDialog({ action: "close", kind: "action" })} type="button">请求安全关闭</button>{data.status === "CLOSED" ? <button className="danger-button" onClick={() => setDialog({ kind: "delete" })} type="button">永久删除房间数据</button> : null}</div><UiDialog busy={working} confirmLabel="确认执行" danger={dialog?.kind === "action" && dialog.action === "close"} description={`即将执行：${actionName}`} fields={[{ id: "reason", label: "操作原因", minLength: 8 }]} onCancel={() => setDialog(null)} onConfirm={confirmDialog} open={dialog?.kind === "action"} title="确认房间操作" /><UiDialog busy={working} confirmLabel="永久删除" danger description="房间、手牌、玩家记录和本地日志都会删除，此操作不可撤销。" fields={[{ id: "reason", label: "删除原因", minLength: 8 }, { expectedValue: "永久删除", id: "confirmation", label: "输入“永久删除”" }]} onCancel={() => setDialog(null)} onConfirm={confirmDialog} open={dialog?.kind === "delete"} title="删除房间数据" /></div>;
}

export function AdminRecoveryPage() {
  const [page, setPage] = useState<AdminPageResult>({ items: [], nextCursor: null });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ readonly action: "retry" | "revalidate"; readonly roomId: string } | null>(null);
  const [working, setWorking] = useState(false);
  const load = useCallback(async () => { try { setPage(await getAdminPage("/recovery")); setError(null); } catch (caught) { setError(readableError(caught)); } }, []);
  useEffect(() => { void load(); }, [load]);
  const act = async (values: Readonly<Record<string, string>>) => {
    if (!pending) return;
    setWorking(true);
    try { await mutateAdminRecovery(pending.roomId, pending.action, { operationId: createOperationId(), reason: values.reason ?? "" }); setPending(null); await load(); }
    catch (caught) { setError(readableError(caught)); }
    finally { setWorking(false); }
  };
  return <div><PageHeading description="只使用数据库权威状态；不重置手牌、Stack 或 Snapshot。" title="Recovery 管理" /><ErrorNotice error={error} /><div className="mt-4 space-y-3">{page.items.map((item) => { const room = asRecord(item.room); const roomId = String(room.id ?? ""); return <article className="rounded-xl border border-white/10 bg-white/[0.04] p-4" key={roomId}><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-medium">{String(room.roomCode ?? roomId)}</h2><p className="text-xs text-stone-400">{formatValue(item.runtimeStatus)} · {formatValue(item.recoveryStatus)} · rev {formatValue(item.snapshotRevision)}</p></div><div className="flex gap-2"><button className="secondary-button" onClick={() => setPending({ action: "revalidate", roomId })} type="button">重新验证</button><button className="secondary-button" onClick={() => setPending({ action: "retry", roomId })} type="button">重试 Hydration</button></div></div>{item.safeErrorCode ? <p className="mt-2 flex items-center gap-2 text-xs text-red-200"><ShieldAlert size={14} />{formatValue(item.safeErrorCode)}</p> : null}</article>; })}</div><UiDialog busy={working} confirmLabel="执行" fields={[{ id: "reason", label: "Recovery 操作原因", minLength: 8 }]} onCancel={() => setPending(null)} onConfirm={act} open={pending !== null} title={pending?.action === "retry" ? "重试 Hydration" : "重新验证 Recovery"} /></div>;
}
