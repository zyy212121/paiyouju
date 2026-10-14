import type { ProjectedAction, ProjectedSeat } from "@paiyouju/shared";

const eventLabels: Readonly<Record<ProjectedAction["eventType"], string>> = {
  BLIND_POSTED: "下盲注",
  BOARD_DEALT: "发公共牌",
  BUTTON_ASSIGNED: "确定庄位",
  CARDS_REVEALED: "公开底牌",
  HAND_FINISHED: "本手结束",
  HAND_STARTED: "开始一手",
  HOLE_CARDS_DEALT: "发底牌",
  PLAYER_ALL_IN: "全下",
  PLAYER_BET: "下注",
  PLAYER_CALLED: "跟注",
  PLAYER_CHECKED: "过牌",
  PLAYER_FOLDED: "弃牌",
  PLAYER_RAISED: "加注",
  POT_AWARDED: "赢得底池",
  RUNOUT_CHOICE_RESOLVED: "发牌次数已确定",
  RUNOUT_CHOICE_STARTED: "协商发牌次数",
  SHOWDOWN_STARTED: "开始摊牌",
  STREET_ADVANCED: "进入下一街",
  UNCALLED_BET_RETURNED: "退回未匹配下注",
};

export function ActionLog({ events, seats }: { readonly events: readonly ProjectedAction[]; readonly seats: readonly ProjectedSeat[] }) {
  return (
    <aside className="panel max-h-72 overflow-auto p-4 lg:max-h-none">
      <h2 className="text-sm font-medium">行动记录</h2>
      <ol className="mt-3 space-y-2 text-xs text-stone-400">
        {events.slice(-18).reverse().map((event, index) => {
          const amount = "amount" in event ? event.amount : undefined;
          const playerId = "playerId" in event ? event.playerId : undefined;
          return <li className="border-l border-white/10 pl-2" key={`${event.eventType}-${event.stateVersion}-${index}`}>{eventLabels[event.eventType]}{amount === undefined ? "" : ` ${amount.toLocaleString()}`}{playerId ? ` · ${seats.find((seat) => seat.userId === playerId)?.nickname ?? "玩家"}` : ""}</li>;
        })}
        {events.length === 0 && <li>等待牌局开始</li>}
      </ol>
    </aside>
  );
}
