import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "./components/AppShell.js";
import { ProtectedRoute } from "./components/ProtectedRoute.js";
import { AuthPage } from "./pages/AuthPage.js";
import { CreateRoomPage } from "./pages/CreateRoomPage.js";
import { JoinRoomPage } from "./pages/JoinRoomPage.js";
import { LobbyPage } from "./pages/LobbyPage.js";
import { ProfilePage } from "./pages/ProfilePage.js";
import { RoomPage } from "./pages/RoomPage.js";
import { TablePage } from "./pages/TablePage.js";
import { WalletPage } from "./pages/WalletPage.js";
import { useAuthStore } from "./stores/auth-store.js";
import { PwaCoordinator } from "./pwa/PwaCoordinator.js";
import { AdminGate } from "./features/admin/AdminGate.js";
import { AdminLayout } from "./features/admin/AdminLayout.js";

const GamesPage = lazy(async () => ({ default: (await import("./pages/GamesPage.js")).GamesPage }));
const GameSessionPage = lazy(async () => ({ default: (await import("./pages/GameSessionPage.js")).GameSessionPage }));
const HandDetailPage = lazy(async () => ({ default: (await import("./pages/HandDetailPage.js")).HandDetailPage }));
const HandsPage = lazy(async () => ({ default: (await import("./pages/HandsPage.js")).HandsPage }));
const ReplayPage = lazy(async () => ({ default: (await import("./pages/ReplayPage.js")).ReplayPage }));
const AdminDashboardPage = lazy(async () => ({ default: (await import("./features/admin/AdminPages.js")).AdminDashboardPage }));
const AdminDetailPage = lazy(async () => ({ default: (await import("./features/admin/AdminPages.js")).AdminDetailPage }));
const AdminRecoveryPage = lazy(async () => ({ default: (await import("./features/admin/AdminPages.js")).AdminRecoveryPage }));
const AdminResourcePage = lazy(async () => ({ default: (await import("./features/admin/AdminPages.js")).AdminResourcePage }));
const AdminRoomDetailPage = lazy(async () => ({ default: (await import("./features/admin/AdminPages.js")).AdminRoomDetailPage }));
const AdminUserDetailPage = lazy(async () => ({ default: (await import("./features/admin/AdminPages.js")).AdminUserDetailPage }));

function RouteFallback() {
  return <main aria-live="polite" className="page-shell" role="status">正在加载页面…</main>;
}

export function App() {
  const restore = useAuthStore((state) => state.restore);
  useEffect(() => { void restore(); }, [restore]);
  return (
    <BrowserRouter>
      <PwaCoordinator />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
        <Route element={<AuthPage mode="login" />} path="/login" />
        <Route element={<AuthPage mode="register" />} path="/register" />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route element={<LobbyPage />} index />
            <Route element={<GamesPage />} path="games" />
            <Route element={<GameSessionPage />} path="games/:gameSessionId" />
            <Route element={<HandsPage />} path="hands" />
            <Route element={<HandDetailPage />} path="hands/:handId" />
            <Route element={<ReplayPage />} path="hands/:handId/replay" />
            <Route element={<ProfilePage />} path="profile" />
            <Route element={<WalletPage />} path="wallet" />
            <Route element={<CreateRoomPage />} path="rooms/create" />
            <Route element={<JoinRoomPage />} path="rooms/join" />
            <Route element={<RoomPage />} path="rooms/:roomId" />
            <Route element={<TablePage />} path="tables/:roomId" />
            <Route element={<AdminGate />}>
              <Route element={<AdminLayout />} path="admin">
                <Route element={<AdminDashboardPage />} index />
                <Route element={<AdminResourcePage detailBase="/admin/users" endpoint="/users" title="用户管理" />} path="users" />
                <Route element={<AdminUserDetailPage />} path="users/:userId" />
                <Route element={<AdminResourcePage detailBase="/admin/rooms" endpoint="/rooms" title="房间管理" />} path="rooms" />
                <Route element={<AdminRoomDetailPage />} path="rooms/:roomId" />
                <Route element={<AdminResourcePage endpoint="/tables" title="活动牌桌" />} path="tables" />
                <Route element={<AdminResourcePage detailBase="/admin/games" endpoint="/games" title="对局审计" />} path="games" />
                <Route element={<AdminDetailPage endpoint="/games" title="对局详情" />} path="games/:gameSessionId" />
                <Route element={<AdminResourcePage detailBase="/admin/hands" endpoint="/hands" title="完成手牌" />} path="hands" />
                <Route element={<AdminDetailPage endpoint="/hands" title="完整已结束手牌审计" />} path="hands/:handId" />
                <Route element={<AdminResourcePage endpoint="/wallet-ledger" title="Wallet Ledger" />} path="wallet-ledger" />
                <Route element={<AdminResourcePage description="按固定钻石费率校验偷偷看、发发看、加时和开局费用。" endpoint="/point-actions" title="钻石行为审计" />} path="point-actions" />
                <Route element={<AdminResourcePage endpoint="/paid-reveals" title="偷偷看购买" />} path="paid-reveals" />
                <Route element={<AdminResourcePage endpoint="/hypothetical-runouts" title="发发看审计" />} path="hypothetical-runouts" />
                <Route element={<AdminResourcePage endpoint="/audit-logs" title="AuditLog" />} path="audit-logs" />
                <Route element={<AdminRecoveryPage />} path="recovery" />
                <Route element={<AdminDetailPage endpoint="/system" title="系统状态" />} path="system" />
              </Route>
            </Route>
          </Route>
        </Route>
        <Route element={<Navigate replace to="/" />} path="*" />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
