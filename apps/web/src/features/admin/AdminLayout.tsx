import {
  Activity,
  BookOpenCheck,
  Coins,
  DatabaseBackup,
  FileClock,
  Gauge,
  History,
  ListChecks,
  Radio,
  ScrollText,
  ServerCog,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";

const links = [
  ["概览", "/admin", Gauge],
  ["用户", "/admin/users", Users],
  ["房间", "/admin/rooms", Radio],
  ["活动牌桌", "/admin/tables", Activity],
  ["对局", "/admin/games", History],
  ["手牌", "/admin/hands", BookOpenCheck],
  ["钻石流水", "/admin/wallet-ledger", Coins],
  ["钻石行为", "/admin/point-actions", ListChecks],
  ["偷偷看", "/admin/paid-reveals", ShieldCheck],
  ["发发看", "/admin/hypothetical-runouts", Sparkles],
  ["审计日志", "/admin/audit-logs", ScrollText],
  ["Recovery", "/admin/recovery", DatabaseBackup],
  ["系统", "/admin/system", ServerCog],
] as const;

export function AdminLayout() {
  return (
    <div className="grid min-w-0 max-w-full gap-5 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <aside className="min-w-0 max-w-full self-start rounded-2xl border border-white/10 bg-black/20 p-2 lg:sticky lg:top-20">
        <div className="mb-2 flex items-center gap-2 px-3 py-2 text-sm font-semibold text-amber-200">
          <FileClock size={17} />管理控制台
        </div>
        <nav aria-label="管理后台导航" className="flex max-w-full gap-1 overflow-x-auto lg:flex-col">
          {links.map(([label, to, Icon]) => (
            <NavLink
              className={({ isActive }) => `flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm ${isActive ? "bg-amber-300/15 text-amber-100" : "text-stone-300 hover:bg-white/10"}`}
              end={to === "/admin"}
              key={to}
              to={to}
            >
              <Icon size={15} />{label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <section className="min-w-0"><Outlet /></section>
    </div>
  );
}
