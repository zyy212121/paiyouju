import { PRODUCT_NAME } from "@paiyouju/shared";
import { Eye, EyeOff } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { useAuthStore } from "../stores/auth-store.js";
import { useNetworkStore } from "../stores/network-store.js";

export function AuthPage({ mode }: { readonly mode: "login" | "register" }) {
  const navigate = useNavigate();
  const location = useLocation();
  const status = useAuthStore((state) => state.status);
  const error = useAuthStore((state) => state.error);
  const clearError = useAuthStore((state) => state.clearError);
  const login = useAuthStore((state) => state.login);
  const register = useAuthStore((state) => state.register);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [nickname, setNickname] = useState("");
  const online = useNetworkStore((state) => state.online);
  const destination = typeof (location.state as { readonly from?: unknown } | null)?.from === "string"
    ? (location.state as { readonly from: string }).from
    : "/";
  useEffect(() => { clearError(); }, [clearError, mode]);
  useEffect(() => { if (status === "authenticated") navigate(destination, { replace: true }); }, [destination, navigate, status]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      if (mode === "login") await login({ identifier, password });
      else await register({ nickname, password, phoneNumber: identifier });
    } catch { /* store renders stable server message */ }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-[radial-gradient(circle_at_20%_10%,#115e59,#071a18_52%,#020a09)] px-4 py-8 text-stone-100">
      <section className="w-full max-w-md rounded-[2rem] border border-white/10 bg-white/[0.06] p-6 shadow-2xl shadow-black/40 backdrop-blur sm:p-8">
        <div className="mb-7 flex items-center gap-3"><span className="grid size-11 place-items-center rounded-2xl bg-amber-300/10 text-xl text-amber-200">牌</span><div><h1 className="text-2xl font-semibold">{PRODUCT_NAME}</h1><p className="text-sm text-stone-400">私人娱乐钻石牌局</p></div></div>
        <h2 className="text-xl font-medium">{mode === "login" ? "欢迎回来" : "建立你的账户"}</h2>
        <form className="mt-6 space-y-4" onSubmit={(event) => { void submit(event); }}>
          <label className="block text-sm text-stone-300">{mode === "login" ? "手机号或管理员账号" : "手机号"}<input
            autoComplete={mode === "login" ? "username" : "tel"}
            className="field mt-2"
            inputMode={mode === "login" ? "text" : "numeric"}
            maxLength={mode === "login" ? 32 : 11}
            {...(mode === "login" ? {} : { minLength: 11, pattern: "1[0-9]{10}" })}
            onChange={(event) => setIdentifier(event.target.value)}
            required
            type={mode === "login" ? "text" : "tel"}
            value={identifier}
          /></label>
          {mode === "register" && <label className="block text-sm text-stone-300">昵称<input className="field mt-2" maxLength={20} onChange={(event) => setNickname(event.target.value)} required value={nickname} /></label>}
          <div className="block text-sm text-stone-300">
            <label htmlFor="auth-password">密码</label>
            <div className="relative mt-2">
              <input id="auth-password" autoComplete={mode === "login" ? "current-password" : "new-password"} className="field pr-12" maxLength={128} minLength={8} onChange={(event) => setPassword(event.target.value)} required type={passwordVisible ? "text" : "password"} value={password} />
              <button aria-label={passwordVisible ? "隐藏密码" : "显示密码"} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-stone-400 hover:text-stone-100" onClick={() => setPasswordVisible((visible) => !visible)} type="button">{passwordVisible ? <EyeOff size={18} /> : <Eye size={18} />}</button>
            </div>
          </div>
          {error && <p role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">{error}</p>}
          <button className="primary-button w-full" disabled={status === "working" || !online} type="submit">{status === "working" ? "请稍候…" : !online ? "离线时不可提交" : mode === "login" ? "登录" : "注册并登录"}</button>
        </form>
        <p className="mt-5 text-center text-sm text-stone-400">{mode === "login" ? "还没有账户？" : "已经有账户？"}<Link className="ml-2 text-teal-300 hover:text-teal-200" to={mode === "login" ? "/register" : "/login"}>{mode === "login" ? "立即注册" : "去登录"}</Link></p>
      </section>
    </main>
  );
}
