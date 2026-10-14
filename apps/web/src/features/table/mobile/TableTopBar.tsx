import type { TableStateProjection } from "@paiyouju/shared";
import { History, Menu, Plus, ShoppingCart, Volume2, VolumeX, Wifi, WifiOff } from "lucide-react";

export function TableTopBar({ connection, onCart, onCopyInvite, onHistory, onMenu, onToggleSound, soundEnabled, state }: {
  readonly connection: "connected" | "reconnecting" | "disconnected";
  readonly onCart: () => void;
  readonly onCopyInvite: () => void;
  readonly onHistory: () => void;
  readonly onMenu: () => void;
  readonly onToggleSound: () => void;
  readonly soundEnabled: boolean;
  readonly state: TableStateProjection;
}) {
  return (
    <header className="table-top-bar" data-testid="table-top-bar">
      <button aria-label="打开牌桌菜单" className="table-icon-button" onClick={onMenu} type="button"><Menu /></button>
      <div className="min-w-0 flex-1 px-2 text-center"><p className="truncate text-xs font-medium">{state.room.name}</p><p className="truncate text-[10px] text-emerald-100/55">#{state.room.roomCode} · {state.room.smallBlind}/{state.room.bigBlind}</p></div>
      <div className="flex items-center gap-1">
        <button aria-label="复制邀请信息" className="table-icon-button" onClick={onCopyInvite} type="button"><Plus /></button>
        <button aria-label="补充牌桌后手" className="table-icon-button" onClick={onCart} type="button"><ShoppingCart /></button>
        <button aria-label="打开牌桌历史" className="table-icon-button" onClick={onHistory} type="button"><History /></button>
        <button aria-label={soundEnabled ? "关闭牌桌音效" : "开启牌桌音效"} aria-pressed={soundEnabled} className="table-icon-button" onClick={onToggleSound} type="button">{soundEnabled ? <Volume2 /> : <VolumeX />}</button>
        <span aria-label={`网络状态：${connection === "connected" ? "已连接" : connection === "reconnecting" ? "正在重连" : "已断开"}`} className={`table-network ${connection}`} title={connection}>{connection === "connected" ? <Wifi /> : <WifiOff />}</span>
      </div>
    </header>
  );
}
