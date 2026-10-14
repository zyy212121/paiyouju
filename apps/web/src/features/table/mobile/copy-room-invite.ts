import type { TableStateProjection } from "@paiyouju/shared";

export function roomInviteText(room: TableStateProjection["room"], origin = window.location.origin): string {
  const link = `${origin}/rooms/join?roomCode=${encodeURIComponent(room.roomCode)}`;
  return [
    `牌友局：${room.name}`,
    `房间码：${room.roomCode}`,
    `盲注：${room.smallBlind}/${room.bigBlind}`,
    `人数：最多 ${room.maxSeats} 人`,
    `加入链接：${link}`,
  ].join("\n");
}

export async function copyRoomInvite(room: TableStateProjection["room"]): Promise<boolean> {
  const text = roomInviteText(room);
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.readOnly = true;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  } catch {
    return false;
  }
}
