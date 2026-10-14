import { z } from "zod";
import {
  BOMB_POT_BLIND_MULTIPLIER_MAX,
  BOMB_POT_BLIND_MULTIPLIER_MIN,
  isBombPotIntervalMinutes,
  squidStakeOptions,
} from "@paiyouju/shared";

import { MAX_POINTS } from "../../config/environment.js";

const VisibleNameSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => Array.from(value).length <= 40)
  .refine((value) => !/\p{Cc}/u.test(value))
  .refine((value) => !/[<>]/.test(value));

const OptionalRoomPasswordSchema = z
  .string()
  .min(4)
  .max(64)
  .refine((value) => value.trim().length > 0)
  .optional();

export const CreateRoomInputSchema = z
  .object({
    actionTimeSeconds: z.number().int().min(10).max(45).refine((value) => value % 5 === 0),
    bigBlind: z.number().int().min(2).max(MAX_POINTS),
    bombPotBlindMultiplier: z.number().int().min(BOMB_POT_BLIND_MULTIPLIER_MIN).max(BOMB_POT_BLIND_MULTIPLIER_MAX).nullable().optional(),
    bombPotIntervalMinutes: z.number().int()
      .refine(isBombPotIntervalMinutes)
      .nullable()
      .optional(),
    durationMinutes: z.number().int().min(30).max(180).refine((value) => value % 30 === 0),
    initialBuyIn: z.number().int().min(1).max(MAX_POINTS).optional(),
    maximumBuyIn: z.number().int().min(1).max(MAX_POINTS).optional(),
    maxSeats: z.number().int().min(2).max(9),
    minimumBuyIn: z.number().int().min(1).max(MAX_POINTS).optional(),
    name: VisibleNameSchema,
    password: OptionalRoomPasswordSchema,
    runItTwiceEnabled: z.boolean().default(false),
    specialMode: z.enum(["NORMAL", "SQUID", "SHORT_DECK", "BOMB_POT"]).default("NORMAL"),
    squidStake: z.number().int().min(1).max(MAX_POINTS).nullable().optional(),
  })
  .strict()
  .superRefine((room, context) => {
    if (room.specialMode === "SHORT_DECK" && (room.minimumBuyIn === undefined || room.maximumBuyIn === undefined)) {
      context.addIssue({ code: "custom", message: "short-deck rooms require lower and upper stack limits", path: ["minimumBuyIn"] });
    } else if (room.specialMode !== "SHORT_DECK" && room.initialBuyIn === undefined && (room.minimumBuyIn === undefined || room.maximumBuyIn === undefined)) {
      context.addIssue({ code: "custom", message: "initial buy-in is required", path: ["initialBuyIn"] });
    }
    if (room.specialMode === "SHORT_DECK" && room.minimumBuyIn !== undefined && room.minimumBuyIn <= room.bigBlind) {
      context.addIssue({ code: "custom", message: "short-deck lower stack limit must exceed the big blind", path: ["minimumBuyIn"] });
    }
    if (room.maximumBuyIn !== undefined && room.minimumBuyIn !== undefined && room.maximumBuyIn < room.minimumBuyIn) {
      context.addIssue({ code: "custom", message: "maximum buy-in must cover minimum", path: ["maximumBuyIn"] });
    }
    if (room.maximumBuyIn !== undefined && room.maximumBuyIn * room.maxSeats > MAX_POINTS) {
      context.addIssue({ code: "custom", message: "configured table points exceed the safe aggregate limit", path: ["maximumBuyIn"] });
    }
    if (room.specialMode === "SHORT_DECK" && room.initialBuyIn !== undefined && room.initialBuyIn !== room.minimumBuyIn) {
      context.addIssue({ code: "custom", message: "short-deck initial stack must equal its lower limit", path: ["initialBuyIn"] });
    }
    const resolvedInitial = room.specialMode === "SHORT_DECK"
      ? room.minimumBuyIn ?? 1
      : room.initialBuyIn
        ?? Math.min(room.maximumBuyIn ?? MAX_POINTS, Math.max(room.minimumBuyIn ?? 1, room.bigBlind * 100));
    if (room.bigBlind >= resolvedInitial) {
      context.addIssue({ code: "custom", message: "big blind must stay below the initial buy-in", path: ["bigBlind"] });
    }
    if (resolvedInitial * room.maxSeats > MAX_POINTS) {
      context.addIssue({ code: "custom", message: "initial table points exceed the safe aggregate limit", path: ["initialBuyIn"] });
    }
    if (room.specialMode === "SQUID") {
      if (room.squidStake === undefined || room.squidStake === null || !squidStakeOptions(resolvedInitial).includes(room.squidStake)) {
        context.addIssue({ code: "custom", message: "squid stake must match an initial-buy-in tier", path: ["squidStake"] });
      }
    } else if (room.squidStake !== undefined && room.squidStake !== null) {
      context.addIssue({ code: "custom", message: "non-squid rooms cannot configure a squid stake", path: ["squidStake"] });
    }
    if (room.specialMode === "BOMB_POT") {
      if (room.bombPotBlindMultiplier === undefined || room.bombPotBlindMultiplier === null) {
        context.addIssue({ code: "custom", message: "bomb-pot rooms require a blind multiplier", path: ["bombPotBlindMultiplier"] });
      }
      if (room.bombPotIntervalMinutes === undefined || room.bombPotIntervalMinutes === null) {
        context.addIssue({ code: "custom", message: "bomb-pot rooms require an interval", path: ["bombPotIntervalMinutes"] });
      }
      if (room.bombPotBlindMultiplier !== undefined && room.bombPotBlindMultiplier !== null && room.bigBlind * room.bombPotBlindMultiplier > MAX_POINTS) {
        context.addIssue({ code: "custom", message: "bomb-pot blind exceeds the safe points limit", path: ["bombPotBlindMultiplier"] });
      }
    } else {
      if (room.bombPotBlindMultiplier !== undefined && room.bombPotBlindMultiplier !== null) {
        context.addIssue({ code: "custom", message: "non-bomb-pot rooms cannot configure a bomb blind", path: ["bombPotBlindMultiplier"] });
      }
      if (room.bombPotIntervalMinutes !== undefined && room.bombPotIntervalMinutes !== null) {
        context.addIssue({ code: "custom", message: "non-bomb-pot rooms cannot configure a bomb interval", path: ["bombPotIntervalMinutes"] });
      }
    }
  })
  .transform((room) => {
    const minimumBuyIn = room.minimumBuyIn ?? room.bigBlind;
    const maximumBuyIn = room.maximumBuyIn ?? Math.floor(MAX_POINTS / room.maxSeats);
    const initialBuyIn = room.specialMode === "SHORT_DECK"
      ? minimumBuyIn
      : room.initialBuyIn
        ?? Math.min(maximumBuyIn, Math.max(minimumBuyIn, room.bigBlind * 100));
    return {
      ...room,
      bombPotBlindMultiplier: room.specialMode === "BOMB_POT" ? room.bombPotBlindMultiplier! : null,
      bombPotIntervalMinutes: room.specialMode === "BOMB_POT" ? room.bombPotIntervalMinutes! : null,
      initialBuyIn,
      maximumBuyIn,
      minimumBuyIn,
      runItTwiceEnabled: room.specialMode === "NORMAL" ? room.runItTwiceEnabled : false,
      smallBlind: Math.ceil(room.bigBlind / 2),
      squidStake: room.specialMode === "SQUID" ? room.squidStake! : null,
    };
  });

export const JoinRoomInputSchema = z
  .object({
    password: OptionalRoomPasswordSchema,
    roomCode: z.string().regex(/^\d{6}$/),
  })
  .strict();

export const RoomIdParamsSchema = z.object({ roomId: z.string().cuid() }).strict();
export const IdempotencyKeySchema = z.string().min(1).max(128);

export type CreateRoomInput = Omit<z.infer<typeof CreateRoomInputSchema>, "bombPotBlindMultiplier" | "bombPotIntervalMinutes" | "runItTwiceEnabled"> & {
  readonly bombPotBlindMultiplier?: number | null;
  readonly bombPotIntervalMinutes?: number | null;
  readonly runItTwiceEnabled?: boolean;
};
export type JoinRoomInput = z.infer<typeof JoinRoomInputSchema>;
