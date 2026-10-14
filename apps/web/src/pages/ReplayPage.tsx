import type { HandReplay } from "@paiyouju/shared";
import { replayStateAt } from "@paiyouju/shared";
import { ArrowLeft, ChevronsRight, Pause, Play, RotateCcw, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { readableError } from "../api/client.js";
import { getReplay } from "../api/hands.js";
import { ReplayTable } from "../features/replay/ReplayTable.js";
import { historyEventLabel } from "../features/history/history-format.js";
import { useNetworkStore } from "../stores/network-store.js";

export function ReplayPage() {
  const { handId = "" } = useParams();
  const [replay, setReplay] = useState<HandReplay | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const requestEpoch = useRef(0);
  const refreshVersion = useNetworkStore((state) => state.refreshVersion);
  useEffect(() => {
    const controller = new AbortController();
    const epoch = ++requestEpoch.current;
    setReplay((current) => current?.handId === handId ? current : null);
    setStep(0);
    setPlaying(false);
    setError(null);
    void getReplay(handId, controller.signal).then((value) => {
      if (!controller.signal.aborted && epoch === requestEpoch.current && value.handId === handId) setReplay(value);
    }).catch((caught: unknown) => {
      if (!controller.signal.aborted && epoch === requestEpoch.current) setError(readableError(caught));
    });
    return () => controller.abort();
  }, [handId, refreshVersion]);
  const visibleReplay = replay?.handId === handId ? replay : null;
  useEffect(() => { if (!playing || !visibleReplay) return; if (step >= visibleReplay.events.length) { setPlaying(false); return; } const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches; const timer = window.setTimeout(() => setStep((current) => Math.min(visibleReplay.events.length, current + 1)), reducedMotion ? 800 : 900 / speed); return () => window.clearTimeout(timer); }, [playing, speed, step, visibleReplay]);
  const state = useMemo(() => visibleReplay ? replayStateAt(visibleReplay.initialState, visibleReplay.events, step) : null, [step, visibleReplay]);
  if (error) return <section className="space-y-4"><Link className="inline-flex items-center gap-2" to={`/hands/${handId}`}><ArrowLeft size={16} /> 返回详情</Link><p className="error-banner" role="alert">{error}</p></section>;
  if (!visibleReplay || !state) return <div className="grid min-h-64 place-items-center" role="status">正在加载回放…</div>;
  const current = step > 0 ? visibleReplay.events[step - 1] : null;
  return <section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><Link className="inline-flex items-center gap-2 text-sm text-stone-300" to={`/hands/${handId}`}><ArrowLeft size={16} /> 返回详情</Link><p className="text-sm text-stone-400">步骤 {step} / {visibleReplay.events.length}</p></div><ReplayTable state={state} /><div className="panel"><p aria-live="polite" className="mb-3 min-h-6 text-center text-sm text-amber-100">{current ? historyEventLabel(current, new Map(visibleReplay.initialState.players.map((player) => [player.userId, player.nickname]))) : "准备开始"}</p><input aria-label="回放步骤" className="w-full accent-amber-300" max={visibleReplay.events.length} min="0" onChange={(event) => { setPlaying(false); setStep(Number(event.target.value)); }} type="range" value={step} /><div className="mt-4 flex flex-wrap items-center justify-center gap-2"><button aria-label="回到开始" className="icon-button" onClick={() => { setPlaying(false); setStep(0); }} type="button"><RotateCcw /></button><button aria-label="上一步" className="icon-button" disabled={step === 0} onClick={() => { setPlaying(false); setStep((value) => Math.max(0, value - 1)); }} type="button"><SkipBack /></button><button className="primary-button min-w-28 gap-2" onClick={() => setPlaying((value) => !value)} type="button">{playing ? <><Pause size={18} /> 暂停</> : <><Play size={18} /> 播放</>}</button><button aria-label="下一步" className="icon-button" disabled={step === visibleReplay.events.length} onClick={() => { setPlaying(false); setStep((value) => Math.min(visibleReplay.events.length, value + 1)); }} type="button"><SkipForward /></button><button aria-label="跳到结束" className="icon-button" disabled={step === visibleReplay.events.length} onClick={() => { setPlaying(false); setStep(visibleReplay.events.length); }} type="button"><ChevronsRight /></button><label className="ml-2 text-xs text-stone-400">速度<select className="ml-2 rounded-lg bg-black/30 p-2" onChange={(event) => setSpeed(Number(event.target.value))} value={speed}><option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option></select></label></div></div></section>;
}
