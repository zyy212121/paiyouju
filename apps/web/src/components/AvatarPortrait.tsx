import { AVATAR_IDS, DEFAULT_AVATAR_ID, type AvatarId } from "@paiyouju/shared";
import type { CSSProperties } from "react";

export function avatarSpriteStyle(avatarId: AvatarId = DEFAULT_AVATAR_ID): CSSProperties {
  const index = Math.max(0, AVATAR_IDS.indexOf(avatarId));
  const column = index % 4;
  const row = Math.floor(index / 4);
  return {
    backgroundImage: "url('/avatars/cartoon-avatar-sheet.webp')",
    backgroundPosition: `${String((column * 100) / 3)}% ${String((row * 100) / 3)}%`,
    backgroundRepeat: "no-repeat",
    backgroundSize: "400% 400%",
  };
}

export function AvatarPortrait({ avatarId = DEFAULT_AVATAR_ID, className = "", label }: {
  readonly avatarId?: AvatarId | undefined;
  readonly className?: string;
  readonly label?: string;
}) {
  return <span
    {...(label ? { "aria-label": label, role: "img" } : { "aria-hidden": true })}
    className={`avatar-portrait ${className}`.trim()}
    data-avatar-id={avatarId}
    style={avatarSpriteStyle(avatarId)}
  />;
}
