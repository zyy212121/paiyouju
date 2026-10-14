import { AVATAR_IDS, type AvatarId, type Profile } from "@paiyouju/shared";
import { LoaderCircle, LogOut, Save, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { readableError } from "../api/client.js";
import { createOperationId } from "../api/client.js";
import { bindPhone } from "../api/account.js";
import { getProfile, updateProfile } from "../api/profile.js";
import { AvatarPortrait } from "../components/AvatarPortrait.js";
import { formatDateTime, signedPoints } from "../features/history/history-format.js";
import { useAuthStore } from "../stores/auth-store.js";
import { useNetworkStore } from "../stores/network-store.js";

export function ProfilePage() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [avatarId, setAvatarId] = useState<AvatarId>(AVATAR_IDS[0]);
  const [nickname, setNickname] = useState("");
  const [saving, setSaving] = useState(false);
  const [bindingPhone, setBindingPhone] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const syncIdentity = useAuthStore((state) => state.updateProfile);
  const syncPhone = useAuthStore((state) => state.updatePhone);
  const logout = useAuthStore((state) => state.logout);
  const online = useNetworkStore((state) => state.online);
  const refreshVersion = useNetworkStore((state) => state.refreshVersion);

  useEffect(() => {
    let live = true;
    void getProfile().then((value) => {
      if (live) {
        setProfile(value);
        setAvatarId(value.avatarId);
        setNickname(value.nickname);
      }
    }).catch((caught: unknown) => {
      if (live) setError(readableError(caught));
    });
    return () => { live = false; };
  }, [refreshVersion]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateProfile({ avatarId, nickname });
      setProfile(updated);
      setAvatarId(updated.avatarId);
      setNickname(updated.nickname);
      syncIdentity(updated.avatarId, updated.nickname, updated.walletBalance);
    } catch (caught: unknown) {
      setError(readableError(caught));
    } finally {
      setSaving(false);
    }
  }

  async function submitPhone() {
    setBindingPhone(true);
    setError(null);
    try {
      const result = await bindPhone({ currentPassword, operationId: createOperationId(), phoneNumber });
      setProfile((value) => value ? { ...value, hasPhoneNumber: true, phoneMasked: result.phoneMasked } : value);
      syncPhone(result.phoneMasked);
      setCurrentPassword("");
      setPhoneNumber("");
    } catch (caught: unknown) {
      setError(readableError(caught));
    } finally {
      setBindingPhone(false);
    }
  }

  if (!profile) {
    return error
      ? <p className="error-banner" role="alert">{error}</p>
      : <div className="grid min-h-64 place-items-center" role="status"><LoaderCircle aria-hidden="true" className="animate-spin" /><span className="sr-only">正在加载个人资料</span></div>;
  }

  return (
    <section className="space-y-5">
      <header className="flex items-center gap-4">
        <AvatarPortrait avatarId={profile.avatarId} className="size-16 shrink-0 rounded-2xl border border-amber-200/25" label={`当前头像 ${profile.avatarId.slice(-2)}`} />
        <div className="min-w-0">
          <p className="eyebrow"><UserRound size={15} /> 个人资料</p>
          <h1 className="page-title truncate">{profile.nickname}</h1>
          <p className="page-subtitle">用户名 {profile.username} · 加入于 {new Date(profile.createdAt).toLocaleDateString("zh-CN")}</p>
          <p className="mt-1 break-all text-[11px] text-stone-500" data-testid="profile-user-id">User ID：{profile.userId}</p>
        </div>
      </header>

      {error && <p className="error-banner" id="profile-error" role="alert">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-3">
          <form className="panel" onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <fieldset>
              <legend className="text-sm text-stone-300">头像</legend>
              <div className="mt-3 grid grid-cols-4 gap-2" data-testid="avatar-picker">
                {AVATAR_IDS.map((candidate) => <button
                  aria-label={`选择头像 ${candidate.slice(-2)}`}
                  aria-pressed={avatarId === candidate}
                  className="avatar-picker-option"
                  key={candidate}
                  onClick={() => setAvatarId(candidate)}
                  type="button"
                ><AvatarPortrait avatarId={candidate} className="size-full rounded-xl" /></button>)}
              </div>
            </fieldset>
            <label className="block text-sm text-stone-300">昵称
              <input aria-describedby={error ? "profile-error profile-nickname-help" : "profile-nickname-help"} aria-invalid={error ? true : undefined} autoComplete="nickname" className="field mt-2" maxLength={20} onChange={(event) => setNickname(event.target.value)} value={nickname} />
            </label>
            <p className="mt-2 text-xs text-stone-500" id="profile-nickname-help">1–20 个可见字符，允许中文，不允许 HTML 或控制字符。</p>
            <button className="primary-button mt-5 w-full gap-2" disabled={saving || !online || nickname.trim() === profile.nickname && avatarId === profile.avatarId} type="submit">
              <Save size={17} /> {saving ? "保存中…" : online ? "保存个人资料" : "离线时不可保存"}
            </button>
          </form>
          <section className="panel">
            <p className="text-sm font-medium">手机号登录</p>
            {profile.hasPhoneNumber ? <p className="mt-2 text-sm text-stone-300">已绑定 {profile.phoneMasked}</p> : <form className="mt-3 space-y-3" onSubmit={(event) => { event.preventDefault(); void submitPhone(); }}>
              <label className="block text-sm text-stone-300">手机号<input autoComplete="tel" className="field mt-2" inputMode="numeric" maxLength={11} onChange={(event) => setPhoneNumber(event.target.value)} pattern="1[0-9]{10}" required type="tel" value={phoneNumber} /></label>
              <label className="block text-sm text-stone-300">当前密码<input autoComplete="current-password" className="field mt-2" maxLength={128} minLength={8} onChange={(event) => setCurrentPassword(event.target.value)} required type="password" value={currentPassword} /></label>
              <p className="text-xs text-stone-500">绑定后普通用户不能自行更换。</p>
              <button className="secondary-button w-full" disabled={bindingPhone || !online} type="submit">{bindingPhone ? "绑定中…" : "绑定手机号"}</button>
            </form>}
          </section>
          <button className="danger-button w-full gap-2 md:hidden" disabled={!online} onClick={() => { void logout().then(() => navigate("/login")); }} type="button"><LogOut size={17} /> {online ? "退出登录" : "离线时不可退出"}</button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="当前 Wallet" testId="profile-wallet" value={profile.walletBalance} />
          <Stat label="参与手数" value={profile.handsPlayed} />
          <Stat label="赢得过底池" value={profile.handsWon} />
          <Stat label="盈利手数" testId="profile-profitable-hands" value={profile.profitableHands} />
          <Stat label="亏损手数" value={profile.handsLost} />
          <Stat label="持平手数" value={profile.handsBreakEven} />
          <Stat label="活动对局" value={profile.activeGameSessions} />
          <Stat label="历史总净结果" tone={profile.totalNetResult >= 0 ? "good" : "bad"} value={signedPoints(profile.totalNetResult)} />
          <Stat label="累计领取点数" testId="profile-total-buy-in" value={profile.totalBuyIn} />
          <Stat label="离桌点数" testId="profile-total-cash-out" value={profile.totalCashOut} />
        </div>
      </div>

      <p className="text-xs text-stone-500">“赢得过底池”与“盈利手数”是不同指标：一手可能赢得边池但总结果仍为负。</p>

      <section className="space-y-3">
        <h2 className="section-title">最近对局</h2>
        {profile.recentGames.map((game) => {
          const result = game.status === "ACTIVE" ? game.provisionalNetResult ?? 0 : game.netResult ?? 0;
          return (
            <Link className="panel history-row" key={game.gameSessionId} to={`/games/${game.gameSessionId}`}>
              <div>
                <p className="font-medium">{game.room.roomName}</p>
                <p className="text-xs text-stone-500">{formatDateTime(game.startedAt)} · {game.status === "ACTIVE" ? "活动中" : "已结束"}</p>
              </div>
              <p className={result >= 0 ? "text-emerald-300" : "text-rose-300"}>{signedPoints(result)}</p>
            </Link>
          );
        })}
        {profile.recentGames.length === 0 && <div className="panel text-sm text-stone-400">还没有对局记录</div>}
      </section>
    </section>
  );
}

function Stat({ label, testId, tone, value }: {
  readonly label: string;
  readonly testId?: string;
  readonly tone?: "good" | "bad";
  readonly value: number | string;
}) {
  return <div className="panel !p-4"><p className="text-xs text-stone-400">{label}</p><p className={`mt-2 text-xl font-semibold ${tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-rose-300" : "text-stone-100"}`} data-testid={testId}>{typeof value === "number" ? value.toLocaleString() : value}</p></div>;
}
