import type { ProjectedAction, ProjectedHand, ProjectedSeat } from "@paiyouju/shared";
import { useCallback, useEffect, useRef, useState } from "react";

const SOUND_KEY = "wepoker.table-sound.enabled";
const VOLUME_KEY = "wepoker.table-sound.volume";
const VOICE_GENDER_KEY = "wepoker.table-sound.voice-gender";
export type TableSound = "board" | "chip" | "chipCollect" | "countdown" | "deal" | "menu" | "squid" | "turn" | "win";
export type TableVoiceGender = "female" | "male";
type TableVoiceAction = "allin" | "call" | "check" | "fold" | "raise";

const seatSamplePath = "/audio/table/sfx/seat_metal_hit.wav";
const standSamplePath = "/audio/table/sfx/stand_whoosh.wav";
const tableSamplePaths: Readonly<Partial<Record<TableSound, string>>> = {
  board: "/audio/table/sfx/fapai.wav",
  chipCollect: "/audio/table/sfx/chipfly.wav",
  countdown: "/audio/table/sfx/daojishi.wav",
  deal: "/audio/table/sfx/fashoupai.wav",
  squid: "/audio/table/sfx/youyu.wav",
  win: "/audio/table/sfx/win.wav",
};

const frequencies: Readonly<Record<TableSound, readonly [number, number]>> = {
  board: [420, 0.18], chip: [720, 0.12], chipCollect: [620, 0.16], countdown: [980, 0.12], deal: [290, 0.16], menu: [520, 0.12], squid: [520, 0.58], turn: [880, 0.24], win: [660, 0.36],
};

type AudioContextConstructor = new () => AudioContext;

function browserAudioContext(): AudioContextConstructor | undefined {
  const safariWindow = window as typeof window & { readonly webkitAudioContext?: AudioContextConstructor };
  return window.AudioContext ?? safariWindow.webkitAudioContext;
}

function initialSoundEnabled(): boolean {
  try { return window.localStorage.getItem(SOUND_KEY) !== "false"; } catch { return true; }
}

function initialVolume(): number {
  try {
    const persisted = window.localStorage.getItem(VOLUME_KEY);
    if (persisted === null || persisted.trim() === "") return 0.7;
    const stored = Number(persisted);
    return Number.isFinite(stored) && stored >= 0 && stored <= 1 ? stored : 0.7;
  } catch { return 0.7; }
}

function initialVoiceGender(): TableVoiceGender {
  try { return window.localStorage.getItem(VOICE_GENDER_KEY) === "female" ? "female" : "male"; } catch { return "male"; }
}

function voiceAction(event: ProjectedAction): TableVoiceAction | null {
  switch (event.eventType) {
    case "PLAYER_ALL_IN": return "allin";
    case "PLAYER_CALLED": return "call";
    case "PLAYER_CHECKED": return "check";
    case "PLAYER_FOLDED": return "fold";
    case "PLAYER_BET":
    case "PLAYER_RAISED": return "raise";
    default: return null;
  }
}

function voiceSamplePath(gender: TableVoiceGender, action: TableVoiceAction): string {
  return `/audio/table/voices/${gender}/${gender}_${action}.wav`;
}

export function settlementSoundForHero(winnerUserIds: readonly string[], heroUserId: string): "chip" | "win" {
  return winnerUserIds.includes(heroUserId) ? "win" : "chip";
}

function settlementRecipientUserIds(events: readonly ProjectedAction[]): readonly string[] {
  return events.flatMap((event) => {
    if (event.eventType === "POT_AWARDED" && event.amount > 0) return event.winners;
    if (event.eventType === "UNCALLED_BET_RETURNED" && event.amount > 0) return [event.playerId];
    return [];
  });
}

export function useTableSound(
  hand: ProjectedHand | null,
  heroUserId: string,
  heroSeatIndex: number | null = null,
  active = true,
  seats: readonly ProjectedSeat[] = [],
  presentedBoardCardCount: number | null = null,
) {
  const [enabled, setEnabled] = useState(initialSoundEnabled);
  const [volume, setVolumeState] = useState(initialVolume);
  const [voiceGender, setVoiceGenderState] = useState<TableVoiceGender>(initialVoiceGender);
  const enabledRef = useRef(enabled);
  const volumeRef = useRef(volume);
  const voiceGenderRef = useRef(voiceGender);
  const context = useRef<AudioContext | null>(null);
  const sampleBuffers = useRef(new Map<string, Promise<AudioBuffer>>());
  const previous = useRef<{
    readonly actions: number;
    readonly actor: number | null;
    readonly board: number;
    readonly handId: string | null;
    readonly seatedUsers: readonly string[];
  } | null>(null);
  const previouslyActive = useRef(active);
  const playTone = useCallback((audio: AudioContext, kind: TableSound) => {
    try {
      const [frequency, duration] = frequencies[kind];
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.frequency.value = frequency;
      oscillator.type = kind === "win" || kind === "squid" ? "sine" : "triangle";
      if (kind === "squid") {
        oscillator.frequency.setValueAtTime(frequency, audio.currentTime);
        oscillator.frequency.setValueAtTime(660, audio.currentTime + 0.16);
        oscillator.frequency.setValueAtTime(780, audio.currentTime + 0.34);
      }
      gain.gain.setValueAtTime(0.0001, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, Number((0.22 * volume).toFixed(4))), audio.currentTime + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration);
      oscillator.connect(gain); gain.connect(audio.destination);
      oscillator.start(); oscillator.stop(audio.currentTime + duration);
    } catch { /* Audio is enhancement-only and must never block poker actions. */ }
  }, [volume]);
  const startAudio = useCallback((kind: TableSound, bypassPreference = false) => {
    if ((!enabledRef.current && !bypassPreference) || !active || document.visibilityState === "hidden") return;
    try {
      if (context.current?.state === "closed") context.current = null;
      const AudioContextClass = browserAudioContext();
      if (!AudioContextClass) return;
      const audio = context.current ?? new AudioContextClass();
      context.current = audio;
      if (audio.state !== "running") {
        void audio.resume().then(() => playTone(audio, kind)).catch(() => undefined);
      } else {
        playTone(audio, kind);
      }
    } catch { /* Audio is enhancement-only and must never block poker actions. */ }
  }, [active, playTone]);
  const playSample = useCallback((path: string) => {
    if (!enabledRef.current || !active || document.visibilityState === "hidden") return;
    try {
      if (context.current?.state === "closed") context.current = null;
      const AudioContextClass = browserAudioContext();
      if (!AudioContextClass) return;
      const audio = context.current ?? new AudioContextClass();
      context.current = audio;
      const start = async () => {
        let loading = sampleBuffers.current.get(path);
        if (!loading) {
          loading = fetch(path, { cache: "force-cache" }).then(async (response) => {
            if (!response.ok) throw new Error(`audio sample unavailable: ${path}`);
            return audio.decodeAudioData(await response.arrayBuffer());
          });
          sampleBuffers.current.set(path, loading);
        }
        try {
          const buffer = await loading;
          if (!enabledRef.current || !active || document.visibilityState === "hidden" || audio.state !== "running") return;
          const source = audio.createBufferSource();
          const gain = audio.createGain();
          source.buffer = buffer;
          gain.gain.setValueAtTime(volumeRef.current, audio.currentTime);
          source.connect(gain);
          gain.connect(audio.destination);
          source.start();
        } catch {
          sampleBuffers.current.delete(path);
        }
      };
      if (audio.state !== "running") void audio.resume().then(start).catch(() => undefined);
      else void start();
    } catch { /* Sample audio is enhancement-only and must never block poker actions. */ }
  }, [active]);
  const play = useCallback((kind: TableSound) => {
    const samplePath = tableSamplePaths[kind];
    if (samplePath) playSample(samplePath);
    else startAudio(kind);
  }, [playSample, startAudio]);
  const toggle = useCallback(() => {
    const next = !enabledRef.current;
    enabledRef.current = next;
    setEnabled(next);
    try { window.localStorage.setItem(SOUND_KEY, String(next)); } catch { /* Private mode may deny storage. */ }
    if (next) startAudio("menu", true);
  }, [startAudio]);
  const setVolume = useCallback((next: number) => {
    const bounded = Math.min(1, Math.max(0, Number.isFinite(next) ? next : 0.7));
    volumeRef.current = bounded;
    setVolumeState(bounded);
    try { window.localStorage.setItem(VOLUME_KEY, String(bounded)); } catch { /* Private mode may deny storage. */ }
  }, []);
  const setVoiceGender = useCallback((next: TableVoiceGender) => {
    voiceGenderRef.current = next;
    setVoiceGenderState(next);
    try { window.localStorage.setItem(VOICE_GENDER_KEY, next); } catch { /* Private mode may deny storage. */ }
  }, []);
  useEffect(() => {
    const current = {
      actions: hand?.actionHistory.length ?? 0,
      actor: hand?.currentActorSeat ?? null,
      board: presentedBoardCardCount ?? hand?.board.length ?? 0,
      handId: hand?.handId ?? null,
      seatedUsers: seats.map((seat) => seat.userId).sort(),
    };
    if (!active) {
      previouslyActive.current = false;
      return;
    }
    const prior = previous.current;
    previous.current = current;
    if (!previouslyActive.current) {
      previouslyActive.current = true;
      return;
    }
    if (!prior) return;
    if (current.handId && current.handId !== prior.handId) {
      play("deal");
    } else {
      if (current.board > prior.board) play("board");
      if (current.actions > prior.actions) {
        const events = hand?.actionHistory.slice(prior.actions) ?? [];
        let spokenAction: TableVoiceAction | null = null;
        for (let index = events.length - 1; index >= 0; index -= 1) {
          spokenAction = voiceAction(events[index]!);
          if (spokenAction) break;
        }
        if (spokenAction) playSample(voiceSamplePath(voiceGenderRef.current, spokenAction));
        const settlementRecipients = settlementRecipientUserIds(events);
        if (settlementRecipients.length > 0) play(settlementSoundForHero(settlementRecipients, heroUserId));
        else if (events.some((event) => event.eventType === "BLIND_POSTED")) play("chip");
      }
    }
    const priorUsers = new Set(prior.seatedUsers);
    const currentUsers = new Set(current.seatedUsers);
    if (current.seatedUsers.some((userId) => !priorUsers.has(userId))) playSample(seatSamplePath);
    if (prior.seatedUsers.some((userId) => !currentUsers.has(userId))) playSample(standSamplePath);
    if (current.handId === prior.handId && heroSeatIndex !== null && current.actor === heroSeatIndex && prior.actor !== heroSeatIndex) play("turn");
  }, [active, hand, heroSeatIndex, heroUserId, play, playSample, presentedBoardCardCount, seats]);
  useEffect(() => {
    if (!enabled || !active) return;
    const unlock = () => {
      window.removeEventListener("pointerdown", unlock, { capture: true });
      window.removeEventListener("touchend", unlock, { capture: true });
      window.removeEventListener("keydown", unlock, { capture: true });
      startAudio("menu");
    };
    window.addEventListener("pointerdown", unlock, { capture: true, once: true, passive: true });
    window.addEventListener("touchend", unlock, { capture: true, once: true, passive: true });
    window.addEventListener("keydown", unlock, { capture: true, once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock, { capture: true });
      window.removeEventListener("touchend", unlock, { capture: true });
      window.removeEventListener("keydown", unlock, { capture: true });
    };
  }, [active, enabled, startAudio]);
  useEffect(() => {
    const foreground = () => {
      if (document.visibilityState !== "visible" || !enabled || !active) return;
      const audio = context.current;
      if (audio?.state === "suspended") void audio.resume().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", foreground);
    return () => document.removeEventListener("visibilitychange", foreground);
  }, [active, enabled]);
  useEffect(() => () => { sampleBuffers.current.clear(); void context.current?.close(); }, []);
  return { enabled, play, setVoiceGender, setVolume, toggle, voiceGender, volume } as const;
}
