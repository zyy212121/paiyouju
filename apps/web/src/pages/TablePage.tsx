import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { MobileTableExperience } from "../features/table/mobile/MobileTableExperience.js";
import { tableSocket } from "../realtime/table-socket.js";
import { useNetworkStore } from "../stores/network-store.js";
import { useTableStore } from "../stores/table-store.js";

export function TablePage() {
  const { roomId = "" } = useParams();
  const state = useTableStore((store) => store.state);
  const connection = useTableStore((store) => store.connection);
  const error = useTableStore((store) => store.error);
  const online = useNetworkStore((store) => store.online);
  const [attemptedRoomId, setAttemptedRoomId] = useState<string | null>(null);
  useEffect(() => {
    tableSocket.connect(roomId);
    setAttemptedRoomId(roomId);
    return () => tableSocket.disconnect();
  }, [roomId]);
  if (!state || state.room.roomId !== roomId) {
    const connectionFailed = attemptedRoomId === roomId && connection === "disconnected";
    const message = error
      ?? (connectionFailed
        ? "无法连接牌桌服务器，请使用启动终端显示的网址重新打开后重试。"
        : "正在恢复服务器权威牌桌状态…");
    return <div className="fixed inset-0 z-[80] grid min-h-dvh place-items-center bg-[#041a16] px-6 text-center text-stone-400" role={error || connectionFailed ? "alert" : "status"}>{message}</div>;
  }
  return <MobileTableExperience connection={connection} error={error} online={online} roomId={roomId} state={state} />;
}
