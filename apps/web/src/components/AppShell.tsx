import { PRODUCT_NAME } from "@paiyouju/shared";
import { Diamond, History, House, LogOut, ShieldCheck, Spade, UserRound, WalletCards } from "lucide-react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { useAuthStore } from "../stores/auth-store.js";
import { useNetworkStore } from "../stores/network-store.js";

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const online = useNetworkStore((state) => state.online);
  if (location.pathname.startsWith("/tables/")) return <Outlet />;
  return (
    <div className="min-h-dvh bg-[radial-gradient(circle_at_top,#164e45_0%,#071a18_48%,#04110f_100%)] text-stone-100">
      <header className="app-header sticky z-40 border-b border-white/10 bg-[#071a18]/90 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <NavLink className="flex items-center gap-3 font-semibold tracking-wide" to="/">
            <span className="grid size-9 place-items-center rounded-xl border border-amber-300/30 bg-amber-300/10 text-amber-200">牌</span>
            <span>{PRODUCT_NAME}</span>
          </NavLink>
          <nav className="hidden items-center gap-1 text-sm md:flex">
            <DesktopLink label="大厅" to="/" />
            <DesktopLink label="对局" to="/games" />
            <DesktopLink label="手牌" to="/hands" />
            <DesktopLink label="钱包" to="/wallet" />
            <DesktopLink label="资料" to="/profile" />
            {user?.role === "ADMIN" ? <DesktopLink label="管理" to="/admin" /> : null}
            <span className="hidden items-center gap-1 text-stone-400 sm:flex">{user?.nickname} · <Diamond size={13} />{user?.walletBalance.toLocaleString()}</span>
            <button aria-label="退出登录" className="icon-button" disabled={!online} onClick={() => { void logout().then(() => navigate("/login")); }} type="button"><LogOut size={18} /></button>
          </nav>
          <span className="flex items-center gap-1 text-sm text-stone-300 md:hidden"><Diamond size={14} />{user?.walletBalance.toLocaleString()}</span>
        </div>
      </header>
      <main className="mx-auto min-w-0 max-w-6xl px-4 py-6 pb-24 sm:py-9 md:pb-9"><Outlet /></main>
      <nav aria-label="主要导航" className={`mobile-nav md:hidden ${user?.role === "ADMIN" ? "grid-cols-6" : "grid-cols-5"}`}><MobileLink icon={<House />} label="大厅" to="/" /><MobileLink icon={<History />} label="对局" to="/games" /><MobileLink icon={<Spade />} label="手牌" to="/hands" /><MobileLink icon={<WalletCards />} label="钱包" to="/wallet" /><MobileLink icon={<UserRound />} label="资料" to="/profile" />{user?.role === "ADMIN" ? <MobileLink icon={<ShieldCheck />} label="管理" to="/admin" /> : null}</nav>
    </div>
  );
}

function DesktopLink({ label, to }: { readonly label: string; readonly to: string }) { return <NavLink className={({ isActive }) => `rounded-lg px-3 py-2 ${isActive ? "bg-white/10 text-white" : "text-stone-300 hover:bg-white/10 hover:text-white"}`} end={to === "/"} to={to}>{label}</NavLink>; }
function MobileLink({ icon, label, to }: { readonly icon: React.ReactNode; readonly label: string; readonly to: string }) { return <NavLink className={({ isActive }) => `mobile-nav-link ${isActive ? "text-amber-200" : "text-stone-400"}`} end={to === "/"} to={to}>{icon}<span>{label}</span></NavLink>; }
