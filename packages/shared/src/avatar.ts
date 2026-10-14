import { z } from "zod";

export const AVATAR_IDS = [
  "avatar-01", "avatar-02", "avatar-03", "avatar-04",
  "avatar-05", "avatar-06", "avatar-07", "avatar-08",
  "avatar-09", "avatar-10", "avatar-11", "avatar-12",
  "avatar-13", "avatar-14", "avatar-15", "avatar-16",
] as const;

export const AvatarIdSchema = z.enum(AVATAR_IDS);
export const DEFAULT_AVATAR_ID = AVATAR_IDS[0];

export type AvatarId = z.infer<typeof AvatarIdSchema>;
