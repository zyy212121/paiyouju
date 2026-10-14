import {
  ROOM_CHAT_BUBBLE_GRAPHEMES,
  splitRoomChatGraphemes,
  type RoomChatMessage,
} from "@paiyouju/shared";
import { useEffect, useMemo, useState } from "react";

export type ChatBubblePlacement = "above" | "below" | "left" | "right" | "hero";

export const CHAT_BUBBLE_PAGE_DURATION_MS = 1_800;
export const CHAT_BUBBLE_FINAL_DURATION_MS = 3_000;

function bubblePages(content: string): readonly string[] {
  const graphemes = splitRoomChatGraphemes(content);
  const pages: string[] = [];
  for (let index = 0; index < graphemes.length; index += ROOM_CHAT_BUBBLE_GRAPHEMES) {
    pages.push(graphemes.slice(index, index + ROOM_CHAT_BUBBLE_GRAPHEMES).join(""));
  }
  return pages;
}

export function PlayerChatBubble({ message, placement }: {
  readonly message: RoomChatMessage;
  readonly placement: ChatBubblePlacement;
}) {
  const pages = useMemo(() => bubblePages(message.content), [message.content]);
  const [pageIndex, setPageIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let active = true;
    let nextPage = 0;
    setPageIndex(0);
    setVisible(true);
    const schedule = (): void => {
      if (nextPage >= pages.length - 1) {
        timer = setTimeout(() => { if (active) setVisible(false); }, CHAT_BUBBLE_FINAL_DURATION_MS);
        return;
      }
      timer = setTimeout(() => {
        if (!active) return;
        nextPage += 1;
        setPageIndex(nextPage);
        schedule();
      }, CHAT_BUBBLE_PAGE_DURATION_MS);
    };
    schedule();
    return () => { active = false; clearTimeout(timer); };
  }, [message.id, pages.length]);

  if (!visible || pages.length === 0) return null;
  return <output aria-label={`${message.sender.nickname}说：${message.content}`} className={`player-chat-bubble chat-placement-${placement}`} data-testid="player-chat-bubble" role="status"><span aria-hidden="true">{pages[pageIndex]}</span></output>;
}
