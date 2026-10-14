import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuthStore } from "../stores/auth-store.js";

export function ProtectedRoute() {
  const location = useLocation();
  const status = useAuthStore((state) => state.status);
  if (status === "booting") return <div className="grid min-h-dvh place-items-center bg-[#071a18] text-stone-200">正在恢复登录状态…</div>;
  if (status !== "authenticated") return <Navigate replace state={{ from: location.pathname }} to="/login" />;
  return <Outlet />;
}
