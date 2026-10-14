import { ShieldX } from "lucide-react";
import { Outlet } from "react-router-dom";

import { useAuthStore } from "../../stores/auth-store.js";

export function AdminGate() {
  const user = useAuthStore((state) => state.user);
  if (user?.role !== "ADMIN") {
    return (
      <section className="mx-auto max-w-xl rounded-2xl border border-red-300/20 bg-red-950/30 p-8 text-center">
        <ShieldX aria-hidden="true" className="mx-auto mb-4 text-red-300" size={40} />
        <h1 className="text-xl font-semibold">无管理员权限</h1>
        <p className="mt-2 text-sm text-stone-300">当前账号不能访问管理后台。</p>
      </section>
    );
  }
  return <Outlet />;
}
