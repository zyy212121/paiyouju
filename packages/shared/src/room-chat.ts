import { z } from "zod";

export const ROOM_CHAT_MAX_GRAPHEMES = 120 as const;
export const ROOM_CHAT_BUBBLE_GRAPHEMES = 24 as const;
export const ROOM_CHAT_HISTORY_LIMIT = 50 as const;

const segmenter = new Intl.Segmenter("zh-CN", { granularity: "grapheme" });

export function splitRoomChatGraphemes(value: string): readonly string[] {
  return [...segmenter.segment(value)].map(({ segment }) => segment);
}

export function countRoomChatGraphemes(value: string): number {
  return splitRoomChatGraphemes(value).length;
}

export function truncateRoomChatGraphemes(value: string, maximum = ROOM_CHAT_MAX_GRAPHEMES): string {
  return splitRoomChatGraphemes(value).slice(0, maximum).join("");
}

export function normalizeRoomChatContent(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

export const RoomChatContentSchema = z.string()
  .max(2_048)
  .transform(normalizeRoomChatContent)
  .pipe(z.string().min(1)
    .refine((value) => !/[\p{Cc}\u202A-\u202E\u2066-\u2069]/u.test(value), { message: "聊天内容包含不可显示控制符" })
    .refine(
      (value) => countRoomChatGraphemes(value) <= ROOM_CHAT_MAX_GRAPHEMES,
      { message: `聊天内容不能超过 ${ROOM_CHAT_MAX_GRAPHEMES} 个字符` },
    ));

export const RoomChatSendSchema = z.object({
  clientMessageId: z.string().uuid(),
  content: RoomChatContentSchema,
  roomId: z.string().min(1).max(64),
}).strict();

export const RoomChatMessageSchema = z.object({
  content: RoomChatContentSchema,
  createdAt: z.iso.datetime({ offset: true }),
  id: z.string().uuid(),
  roomId: z.string().min(1).max(64),
  sender: z.object({
    nickname: z.string().min(1).max(40),
    seatIndex: z.number().int().min(0).max(8).nullable(),
    userId: z.string().min(1),
  }).strict(),
}).strict();

export const RoomChatHistorySchema = z.object({
  messages: z.array(RoomChatMessageSchema).max(ROOM_CHAT_HISTORY_LIMIT),
  roomId: z.string().min(1).max(64),
}).strict();

export type RoomChatSend = z.infer<typeof RoomChatSendSchema>;
export type RoomChatMessage = z.infer<typeof RoomChatMessageSchema>;
export type RoomChatHistory = z.infer<typeof RoomChatHistorySchema>;
