import { Download, RefreshCw, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { registerSW } from "virtual:pwa-register";

import { tableSocket } from "../realtime/table-socket.js";
import { useNetworkStore } from "../stores/network-store.js";
import { useTableStore } from "../stores/table-store.js";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ readonly outcome: "accepted" | "dismissed" }>;
}

export function PwaCoordinator() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [reconnected, setReconnected] = useState(false);
  const updateRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const online = useNetworkStore((state) => state.online);
  const pendingWrites = useNetworkStore((state) => state.pendingWrites);
  const setOnline = useNetworkStore((state) => state.setOnline);
  const activeHand = useTableStore((state) => {
    const status = state.state?.runtimeStatus;
    return status === "PLAYING" || status === "CLOSING" || status === "PERSISTENCE_ERROR" || status === "RECOVERY_ERROR";
  });
  useEffect(() => {
    updateRef.current = registerSW({
      immediate: false,
      onNeedRefresh: () => setNeedRefresh(true),
      onRegisterError: () => undefined,
    });
    const wentOnline = () => {
      const wasOffline = !useNetworkStore.getState().online;
      setOnline(true);
      tableSocket.requestState();
      if (wasOffline) {
        setReconnected(true);
        if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = window.setTimeout(() => setReconnected(false), 4_000);
      }
    };
    const wentOffline = () => {
      setReconnected(false);
      if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
      setOnline(false);
    };
    const beforeInstall = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent); };
    window.addEventListener("online", wentOnline);
    window.addEventListener("offline", wentOffline);
    window.addEventListener("beforeinstallprompt", beforeInstall);
    return () => {
      if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
      window.removeEventListener("online", wentOnline);
      window.removeEventListener("offline", wentOffline);
      window.removeEventListener("beforeinstallprompt", beforeInstall);
    };
  }, [setOnline]);
  if (!online) return <div className="pwa-banner" role="status"><WifiOff size={17} /><span>当前离线。所有写操作已暂停，恢复网络后会刷新权威状态。</span></div>;
  if (needRefresh) { const updateBlocked = activeHand || pendingWrites > 0; return <div className="pwa-banner" role="status"><RefreshCw size={17} /><span>{activeHand ? "新版本已就绪；当前牌局结束后再更新。" : pendingWrites > 0 ? "新版本已就绪；当前操作完成后再更新。" : "新版本已就绪。"}</span><button disabled={updateBlocked} onClick={() => void updateRef.current?.(true)} type="button">安全更新</button></div>; }
  if (reconnected) return <div className="pwa-banner" role="status"><RefreshCw size={17} /><span>已重新连接，正在刷新牌桌与个人数据的权威状态。</span></div>;
  if (installPrompt) return <div className="pwa-banner" role="status"><Download size={17} /><span>可将牌友局安装到设备主屏幕。</span><button onClick={() => { void installPrompt.prompt().then(() => installPrompt.userChoice).finally(() => setInstallPrompt(null)); }} type="button">安装</button></div>;
  return null;
}
