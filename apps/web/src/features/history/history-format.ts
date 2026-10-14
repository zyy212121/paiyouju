import type { HistoryEvent } from "@paiyouju/shared";

const labels: Readonly<Record<HistoryEvent["type"], string>> = {
  BLIND_POSTED: "下盲注",
  CARDS_REVEALED: "亮出底牌",
  FLOP_DEALT: "发出翻牌",
  HAND_FINISHED: "本手结束",
  HAND_STARTED: "开始手牌",
  ODD_CHIP_AWARDED: "获得单数筹码",
  PLAYER_ALL_IN: "全下",
  PLAYER_BET: "下注",
  PLAYER_CALLED: "跟注",
  PLAYER_CHECKED: "过牌",
  PLAYER_FOLDED: "弃牌",
  PLAYER_RAISED: "加注至",
  POT_AWARDED: "赢得底池",
  RIVER_DEALT: "发出河牌",
  SHOWDOWN: "摊牌",
  TURN_DEALT: "发出转牌",
  UNCALLED_BET_RETURNED: "退回未匹配筹码",
};

export function historyEventLabel(event: HistoryEvent, names: ReadonlyMap<string, string>): string {
  const actor = event.actorUserId ? names.get(event.actorUserId) ?? "玩家" : "";
  const amount = event.amount === null ? "" : ` ${event.amount.toLocaleString()}`;
  const label = event.type === "CARDS_REVEALED" && event.visibility === "PURCHASED_AFTER_HAND"
    ? "牌局结束后购买可见"
    : labels[event.type];
  return `${actor ? `${actor} ` : ""}${label}${event.type === "PLAYER_RAISED" && event.raiseTo !== null ? ` ${event.raiseTo.toLocaleString()}` : amount}`;
}

export const formatDateTime = (value: string | null) => value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "进行中";
export const signedPoints = (value: number) => `${value >= 0 ? "+" : ""}${value.toLocaleString()}`;
