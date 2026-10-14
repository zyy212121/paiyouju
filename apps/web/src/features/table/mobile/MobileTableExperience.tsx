import { MAX_POINTS, type NextActionAutopilotMode, type PlayerIntent, type ProjectedSeat, type RoomChatMessage, type TableStateProjection } from "@paiyouju/shared";
import { Trophy } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { createOperationId } from "../../../api/client.js";
import { BoardCards } from "../BoardCards.js";
import { PotDisplay } from "../PotDisplay.js";
import { currentStreetActionLabels, SeatRing } from "../../../components/SeatRing.js";
import { UiDialog } from "../../../components/UiDialog.js";
import { RealtimeClientError, tableSocket } from "../../../realtime/table-socket.js";
import { DurableOperationTracker } from "../../../realtime/durable-operation.js";
import { useAuthStore } from "../../../stores/auth-store.js";
import { useRoomStore } from "../../../stores/room-store.js";
import { useRoomChatStore } from "../../../stores/room-chat-store.js";
import { useTableStore } from "../../../stores/table-store.js";
import { ActionPanel } from "./ActionPanel.js";
import { BuyInModal } from "./BuyInModal.js";
import { CardAnimationCoordinator } from "./CardAnimationCoordinator.js";
import { ChipAwardAnimation } from "./ChipAwardAnimation.js";
import { ChatDrawer } from "./ChatDrawer.js";
import { ConnectionBanner } from "./ConnectionBanner.js";
import { copyRoomInvite } from "./copy-room-invite.js";
import { HeroHand } from "./HeroHand.js";
import { HistoryDrawer } from "./HistoryDrawer.js";
import { MobileTableStage } from "./MobileTableStage.js";
import { PostHandReviewOverlay } from "./PostHandReviewOverlay.js";
import { defaultSeatBuyIn } from "./seat-buy-in.js";
import { squidLeaveConfirmation } from "./squid-leave.js";
import { DraggableDrawerHandle } from "./DraggableDrawerHandle.js";
import { DoubleRunoutBoard } from "./DoubleRunoutBoard.js";
import { RunoutChoiceOverlay } from "./RunoutChoiceOverlay.js";
import { TableCenterInfo } from "./TableCenterInfo.js";
import { TableMenuPopover } from "./TableMenuPopover.js";
import { TableTopBar } from "./TableTopBar.js";
import { TurnUrgencyOverlay } from "./TurnUrgencyOverlay.js";
import { settlementSoundForHero, useTableSound } from "./useTableSound.js";
import { useCommunityRunoutPresentation } from "./useCommunityRunoutPresentation.js";
import { useScreenWakeLock } from "./useScreenWakeLock.js";
import { settlementPresentationState } from "./settlement-presentation.js";

type DurableTableIntent =
  | { readonly event: "hand:arm-next-action-autopilot"; readonly mode: NextActionAutopilotMode }
  | { readonly event: "hand:cancel-next-action-autopilot" | "seat:reserve-away" | "seat:return" | "seat:sit-out" | "table:start" }
  | { readonly confirmSquidPenalty?: boolean; readonly event: "seat:leave" }
  | { readonly enabled: boolean; readonly event: "seat:set-trusteeship" }
  | { readonly amount: number; readonly event: "stack:buy-in" }
  | { readonly buyInAmount: number; readonly event: "seat:take"; readonly seatIndex: number }
  | { readonly cardIndex: 0 | 1; readonly event: "hand:reveal-own-cards"; readonly handId: string }
  | { readonly choice: "ONCE" | "TWICE"; readonly event: "hand:choose-runout-count"; readonly handId: string }
  | { readonly event: "hand:buy-time-extension"; readonly handId: string };

const EMPTY_CHAT_BY_USER: Readonly<Record<string, RoomChatMessage>> = {};

type TableConfirmation =
  | { readonly kind: "owner-close" }
  | { readonly confirmSquidPenalty: boolean; readonly exitAfter: boolean; readonly kind: "leave"; readonly message: string };

function presentedBoardCardCount(boards: readonly [readonly string[], readonly string[]] | null, fallback: number): number {
  if (!boards) return fallback;
  let shared = 0;
  while (shared < boards[0].length && shared < boards[1].length && boards[0][shared] === boards[1][shared]) shared += 1;
  return shared + Math.max(0, boards[0].length - shared) + Math.max(0, boards[1].length - shared);
}

export function MobileTableExperience({ connection, error, online, roomId, state }: {
  readonly connection: "connected" | "reconnecting" | "disconnected";
  readonly error: string | null;
  readonly online: boolean;
  readonly roomId: string;
  readonly state: TableStateProjection;
}) {
  const navigate = useNavigate();
  const user = useAuthStore((store) => store.user)!;
  const updateWallet = useAuthStore((store) => store.updateWalletBalance);
  const ownerAction = useRoomStore((store) => store.ownerAction);
  const tracker = useRef(new DurableOperationTracker<DurableTableIntent>());
  const [working, setWorking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [buyInOpen, setBuyInOpen] = useState(false);
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const [drawer, setDrawer] = useState<"chat" | "history" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<TableConfirmation | null>(null);
  const latestChatByUser = useRoomChatStore((store) => store.roomId === roomId ? store.latestLiveByUser : EMPTY_CHAT_BY_USER);
  const pruneLiveChatForSeats = useRoomChatStore((store) => store.pruneLiveForSeats);
  const runoutPresentation = useCommunityRunoutPresentation(state.hand, state.runtimeStatus === "POST_HAND_REVIEW");
  const previousOwnHandSummary = useRef(state.ownHandSummary);
  if (state.runtimeStatus !== "POST_HAND_REVIEW") previousOwnHandSummary.current = state.ownHandSummary;
  const presentedState = useMemo(() => settlementPresentationState(
    state,
    runoutPresentation.hand,
    runoutPresentation.settlementVisible,
    previousOwnHandSummary.current,
  ), [runoutPresentation.hand, runoutPresentation.settlementVisible, state]);
  const mySeat = useMemo<ProjectedSeat | null>(() => presentedState.seats.find((seat) => seat.userId === presentedState.recipient.userId) ?? null, [presentedState.recipient.userId, presentedState.seats]);
  const myActionLabel = currentStreetActionLabels(presentedState).get(presentedState.recipient.userId) ?? null;
  const totalPot = (presentedState.hand?.mainPot ?? 0) + (presentedState.hand?.sidePots.reduce((sum, pot) => sum + pot, 0) ?? 0);
  const waitingCallAmount = presentedState.hand && mySeat && mySeat.startingStack !== null && !mySeat.hasFolded && !mySeat.isAllIn && presentedState.hand.currentActorSeat !== mySeat.seatIndex
    ? Math.min(mySeat.stack, Math.max(0, presentedState.hand.currentBet - mySeat.committedThisStreet))
    : 0;
  const audibleBoardCardCount = presentedBoardCardCount(runoutPresentation.runoutBoards, runoutPresentation.hand?.board.length ?? 0);
  const sound = useTableSound(runoutPresentation.hand, state.recipient.userId, mySeat?.seatIndex ?? null, connection === "connected", presentedState.seats, audibleBoardCardCount);
  const previousSquidGrace = useRef(state.room.squidRoundGraceEndsAt);
  const previousCompletedRunoutCount = useRef(runoutPresentation.completedRunoutCount);
  const automaticSeatBuyIn = useMemo(() => defaultSeatBuyIn(state.room), [state.room]);
  const canUseHandControls = mySeat !== null && (
    state.hand === null
    || state.hand.ownHoleCards.length === 2
      && mySeat.startingStack !== null
      && !mySeat.hasFolded
      && !mySeat.isAllIn
      && mySeat.playStatus === "ACTIVE"
  ) && !state.trusteeshipEnabled;
  useScreenWakeLock(state.room.status !== "CLOSED");
  useEffect(() => pruneLiveChatForSeats(state.seats), [pruneLiveChatForSeats, state.seats]);
  useEffect(() => {
    if (!runoutPresentation.settlementVisible) return;
    const nextGrace = state.room.squidRoundGraceEndsAt;
    const previousGrace = previousSquidGrace.current;
    previousSquidGrace.current = nextGrace;
    if (nextGrace && nextGrace !== previousGrace && Date.parse(nextGrace) > Date.now()) sound.play("squid");
  }, [runoutPresentation.settlementVisible, sound.play, state.room.squidRoundGraceEndsAt]);
  useEffect(() => {
    const previous = previousCompletedRunoutCount.current;
    const current = runoutPresentation.completedRunoutCount;
    previousCompletedRunoutCount.current = current;
    if (current <= previous) return;
    const result = state.hand?.runoutResults?.[current - 1];
    sound.play(settlementSoundForHero(result?.winnerUserIds ?? [], state.recipient.userId));
  }, [runoutPresentation.completedRunoutCount, sound.play, state.hand?.runoutResults, state.recipient.userId]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2_400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function runDurable(intent: DurableTableIntent, exitAfter = false, confirmedSquidMessage: string | null = null): Promise<boolean> {
    if (working) return false;
    setWorking(true);
    const pending = tracker.current.acquire(intent, state.stateVersion, createOperationId);
    const base = { expectedStateVersion: pending.expectedStateVersion, operationId: pending.operationId, roomId };
    try {
      let walletBalance: number | null = null;
      switch (intent.event) {
        case "hand:arm-next-action-autopilot": await tableSocket.command(intent.event, { ...base, mode: intent.mode }); break;
        case "hand:cancel-next-action-autopilot": await tableSocket.command(intent.event, base); break;
        case "hand:buy-time-extension": walletBalance = (await tableSocket.command(intent.event, { ...base, handId: intent.handId })).walletBalance; break;
        case "hand:choose-runout-count": await tableSocket.command(intent.event, { ...base, choice: intent.choice, handId: intent.handId }); break;
        case "hand:reveal-own-cards": await tableSocket.command(intent.event, { ...base, cardIndex: intent.cardIndex, handId: intent.handId }); break;
        case "seat:leave": {
          const penalty = intent.confirmSquidPenalty === undefined ? {} : { confirmSquidPenalty: intent.confirmSquidPenalty };
          let result;
          try {
            result = await tableSocket.command(intent.event, { ...base, ...penalty });
          } catch (caught: unknown) {
            const latest = caught instanceof RealtimeClientError && caught.serverError?.code === "STALE_STATE"
              ? caught.serverError.latestState : undefined;
            if (!latest || latest.room.roomId !== roomId || latest.recipient.userId !== state.recipient.userId || latest.stateVersion <= pending.expectedStateVersion) throw caught;
            const latestSeat = latest.seats.find((seat) => seat.userId === latest.recipient.userId);
            tracker.current.clear(); // STALE_STATE rejected the command before any mutation.
            if (!latestSeat || latestSeat.playStatus === "LEAVE_AFTER_HAND") {
              useTableStore.getState().clearError();
              tableSocket.requestState();
              if (latestSeat) setToast("已安排本手结束后站起，期间自动让或弃");
              return true;
            }
            const latestConfirmation = squidLeaveConfirmation(latest.room, latestSeat);
            if (latestConfirmation && latestConfirmation.message !== confirmedSquidMessage) {
              useTableStore.getState().clearError();
              setConfirmation({ confirmSquidPenalty: true, exitAfter, kind: "leave", message: latestConfirmation.message });
              return false;
            }
            const retry = tracker.current.acquire(intent, latest.stateVersion, createOperationId);
            result = await tableSocket.command(intent.event, { ...penalty, expectedStateVersion: retry.expectedStateVersion, operationId: retry.operationId, roomId });
            useTableStore.getState().clearError();
          }
          walletBalance = result.walletBalance;
          if ("deferred" in result && result.deferred) setToast("已安排本手结束后站起，期间自动让或弃");
          break;
        }
        case "seat:reserve-away": walletBalance = (await tableSocket.command(intent.event, base)).walletBalance; break;
        case "seat:return": walletBalance = (await tableSocket.command(intent.event, base)).walletBalance; break;
        case "seat:set-trusteeship": await tableSocket.command(intent.event, { ...base, enabled: intent.enabled }); break;
        case "seat:sit-out": walletBalance = (await tableSocket.command(intent.event, base)).walletBalance; break;
        case "seat:take": walletBalance = (await tableSocket.command(intent.event, { ...base, buyInAmount: intent.buyInAmount, seatIndex: intent.seatIndex })).walletBalance; break;
        case "stack:buy-in": walletBalance = (await tableSocket.command(intent.event, { ...base, amount: intent.amount })).walletBalance; break;
        case "table:start": await tableSocket.command(intent.event, base); break;
      }
      tracker.current.clear();
      if (walletBalance !== null) updateWallet(walletBalance);
      tableSocket.requestState();
      return true;
    } catch (caught: unknown) {
      const uncertain = caught instanceof RealtimeClientError && (caught.code === "REALTIME_DISCONNECTED" || caught.code === "REALTIME_TIMEOUT");
      if (!uncertain) tracker.current.clear();
      const silentInsufficientExtension = intent.event === "hand:buy-time-extension" && caught instanceof RealtimeClientError && caught.serverError?.code === "INSUFFICIENT_WALLET_BALANCE";
      if (!uncertain && !silentInsufficientExtension && caught instanceof Error) setToast(caught.message);
      return false;
    } finally { setWorking(false); }
  }

  async function act(intent: PlayerIntent) {
    const hand = state.hand;
    if (!hand) return;
    try { await tableSocket.command("action:submit", { action: intent, clientActionId: createOperationId(), expectedStateVersion: state.stateVersion, handId: hand.handId, roomId }); }
    catch { /* Canonical socket store displays and resynchronizes uncertain actions. */ }
  }

  async function copyInvite() {
    const copied = await copyRoomInvite(state.room);
    setToast(copied ? "邀请信息已复制" : "复制失败，请在房间页查看房间码");
    sound.play("menu");
  }

  async function performOwnerRoomAction(action: "pause" | "resume" | "close") {
    setWorking(true);
    try { await ownerAction(roomId, action); tableSocket.requestState(); setMenuOpen(false); }
    catch { /* Room store renders the stable HTTP error. */ }
    finally { setWorking(false); }
  }

  function ownerRoomAction(action: "pause" | "resume" | "close") {
    if (action === "close") { setConfirmation({ kind: "owner-close" }); return; }
    void performOwnerRoomAction(action);
  }

  async function performStandOrExit(exitAfter: boolean, confirmSquidPenalty: boolean, confirmedSquidMessage: string | null = null) {
    if (!mySeat) {
      if (exitAfter) navigate("/");
      return;
    }
    const completed = await runDurable({ event: "seat:leave", ...(confirmSquidPenalty ? { confirmSquidPenalty: true } : {}) }, exitAfter, confirmedSquidMessage);
    if (!completed) return;
    setMenuOpen(false);
    if (exitAfter) navigate("/");
  }

  function standOrExit(exitAfter: boolean) {
    if (!mySeat) {
      if (exitAfter) navigate("/");
      return;
    }
    const squidConfirmation = squidLeaveConfirmation(state.room, mySeat);
    if (squidConfirmation) {
      setConfirmation({ confirmSquidPenalty: true, exitAfter, kind: "leave", message: squidConfirmation.message });
      return;
    }
    if (exitAfter) {
      setConfirmation({
        confirmSquidPenalty: false,
        exitAfter: true,
        kind: "leave",
        message: "当前仍占座。退出后会站起并保留本房间后手；若正在参与本手，会在本手结束后执行。",
      });
      return;
    }
    void performStandOrExit(false, false);
  }

  function confirmTableAction() {
    const pending = confirmation;
    if (!pending) return;
    if (pending.kind === "leave") {
      const currentSeat = state.seats.find((seat) => seat.userId === state.recipient.userId);
      const currentConfirmation = currentSeat ? squidLeaveConfirmation(state.room, currentSeat) : null;
      if (currentConfirmation && (!pending.confirmSquidPenalty || currentConfirmation.message !== pending.message)) {
        setConfirmation({ ...pending, confirmSquidPenalty: true, message: currentConfirmation.message });
        return;
      }
    }
    setConfirmation(null);
    if (pending.kind === "owner-close") void performOwnerRoomAction("close");
    else void performStandOrExit(pending.exitAfter, pending.confirmSquidPenalty, pending.confirmSquidPenalty ? pending.message : null);
  }

  const tableStack = presentedState.seats.reduce((total, seat) => total + seat.stack, 0);
  const buyInMaximum = Math.min(state.room.initialBuyIn, Math.max(0, MAX_POINTS - tableStack));
  const buyInAllowed = buyInMaximum >= 1;
  function openBuyIn() {
    if (!buyInAllowed) { setToast("牌桌点数已达到系统安全上限"); return; }
    setBuyInOpen(true);
  }
  function confirmBuyIn(amount: number) {
    void runDurable({ amount, event: "stack:buy-in" }).then((completed) => { if (completed) setBuyInOpen(false); });
  }
  function takeEmptySeat(seatIndex: number) {
    if (working) return;
    setSelectedSeat(seatIndex);
    void runDurable({ buyInAmount: automaticSeatBuyIn, event: "seat:take", seatIndex })
      .finally(() => setSelectedSeat(null));
  }
  function reveal(cardIndex: 0 | 1) { if (state.hand) void runDurable({ cardIndex, event: "hand:reveal-own-cards", handId: state.hand.handId }); }
  function chooseRunoutCount(choice: "ONCE" | "TWICE") { if (state.hand) void runDurable({ choice, event: "hand:choose-runout-count", handId: state.hand.handId }); }
  function toggleAutopilot(mode: NextActionAutopilotMode) {
    void runDurable(state.nextActionAutopilot?.mode === mode
      ? { event: "hand:cancel-next-action-autopilot" }
      : { event: "hand:arm-next-action-autopilot", mode });
  }

  return <MobileTableStage
    seated={mySeat !== null}
    action={<ActionPanel actionKey={`${state.hand?.handId ?? "waiting"}:${state.hand?.currentActorSeat ?? "none"}:${state.hand?.turnDeadlineAt ?? "none"}`} actionTimeSeconds={state.room.actionTimeSeconds} activeHand={state.runtimeStatus === "PLAYING" || (state.runtimeStatus === "CLOSING" && state.postHandReviewEndsAt === null)} autopilot={state.nextActionAutopilot} canParticipate={canUseHandControls} currentBet={state.hand?.currentBet ?? 0} deadline={state.hand?.turnDeadlineAt ?? null} disabled={!online || connection !== "connected" || working || state.runtimeStatus === "RECOVERY_ERROR"} legal={state.hand?.legalActions ?? null} onAction={act} onToggleAutopilot={toggleAutopilot} pot={totalPot} waitingCallAmount={waitingCallAmount} />}
    animation={<><CardAnimationCoordinator hand={runoutPresentation.runoutBoards ? null : runoutPresentation.hand} seatedPlayers={state.seats.length} /><ChipAwardAnimation hand={state.hand} heroSeatIndex={mySeat?.seatIndex ?? 0} maxSeats={state.room.maxSeats} onCollect={() => sound.play("chipCollect")} seats={state.seats} visible={runoutPresentation.settlementVisible && (state.runtimeStatus === "POST_HAND_REVIEW" || state.room.squidRoundGraceEndsAt !== null)} /></>}
    board={<>{state.hand?.runoutVote
      ? <RunoutChoiceOverlay disabled={!online || connection !== "connected" || working} onChoose={chooseRunoutCount} userId={state.recipient.userId} vote={state.hand.runoutVote} />
      : runoutPresentation.runoutBoards
        ? <DoubleRunoutBoard boards={runoutPresentation.runoutBoards} completedRunoutCount={runoutPresentation.completedRunoutCount} results={state.hand?.runoutResults ?? null} userId={state.recipient.userId} />
        : <BoardCards cards={runoutPresentation.hand?.board ?? []} />}
      {runoutPresentation.hand && !state.hand?.runoutVote && <div className="mt-1 text-center">{runoutPresentation.hand.bombPotBlind && <p className="mb-1 inline-flex rounded-full border border-rose-300/40 bg-rose-500/20 px-2 py-0.5 text-[10px] font-semibold tracking-[.15em] text-rose-100">暴击 · {runoutPresentation.hand.bombPotBlind.toLocaleString()} 点/人</p>}<p className="text-[10px] uppercase tracking-[.18em] text-emerald-100/55">{runoutPresentation.hand.street} · 第 {runoutPresentation.hand.handNumber} 手</p><PotDisplay mainPot={runoutPresentation.hand.mainPot} sidePots={runoutPresentation.hand.sidePots} /></div>}
      {runoutPresentation.settlementVisible && (state.runtimeStatus === "POST_HAND_REVIEW" || state.room.squidRoundGraceEndsAt) && <PostHandReviewOverlay state={presentedState} />}</>}
    center={<TableCenterInfo onCopyInvite={() => void copyInvite()} onStart={() => void runDurable({ event: "table:start" })} state={presentedState} working={working} />}
    connection={<ConnectionBanner status={connection} />}
    hero={<HeroHand actionLabel={myActionLabel} chatMessage={mySeat ? latestChatByUser[mySeat.userId] ?? null : null} mySeat={mySeat} onReveal={reveal} state={presentedState} working={working} />}
    topBar={<TableTopBar connection={connection} onCart={() => { openBuyIn(); sound.play("menu"); }} onCopyInvite={() => void copyInvite()} onHistory={() => setDrawer("history")} onMenu={() => { setMenuOpen(true); sound.play("menu"); }} onToggleSound={sound.toggle} soundEnabled={sound.enabled} state={state} />}
  >
    <output className="sr-only" data-testid="hand-id">{state.hand?.handId ?? ""}</output>
    <span className="sr-only" data-runtime-status={state.runtimeStatus} data-state-version={state.stateVersion} />
    <time className="sr-only" data-deadline={state.hand?.turnDeadlineAt ?? ""} data-testid="deadline" />
    <SeatRing chatMessagesByUser={latestChatByUser} hideHero={mySeat !== null} maxSeats={state.room.maxSeats} {...(!mySeat && state.room.status === "OPEN" ? { onEmptySeat: takeEmptySeat } : {})} selectedSeat={selectedSeat} stage state={presentedState} />
    <TurnUrgencyOverlay canAfford={user.walletBalance >= state.room.pointFeeRates.actionTimeExtension} deadline={mySeat?.isCurrentActor ? state.hand?.turnDeadlineAt ?? null : null} onExtend={() => { if (state.hand && user.walletBalance >= state.room.pointFeeRates.actionTimeExtension) void runDurable({ event: "hand:buy-time-extension", handId: state.hand.handId }); }} onUrgencySecond={() => sound.play("countdown")} />
    <DraggableDrawerHandle ariaLabel="打开排名和聊天" onClick={() => setDrawer(drawer === "chat" ? null : "chat")} side="left" storageKey="table-info-handle"><Trophy /></DraggableDrawerHandle>
    {toast && <div className="table-toast" role="status">{toast}</div>}
    {error && <div className="table-error" role="alert">{error}</div>}
    {state.runtimeStatus === "RECOVERY_ERROR" && <div className="table-error" role="alert">牌桌恢复失败，已暂停全部操作，请联系管理员。</div>}
    <TableMenuPopover mySeat={mySeat} onClose={() => setMenuOpen(false)} onExit={() => standOrExit(true)} onOwnerAction={ownerRoomAction} onReserveAway={() => void runDurable({ event: "seat:reserve-away" }).then((completed) => { if (completed) setMenuOpen(false); })} onReturn={() => void runDurable({ event: "seat:return" }).then((completed) => { if (completed) setMenuOpen(false); })} onSoundVolume={sound.setVolume} onStand={() => standOrExit(false)} onTrusteeship={() => void runDurable({ enabled: !state.trusteeshipEnabled, event: "seat:set-trusteeship" })} onVoiceGenderChange={sound.setVoiceGender} open={menuOpen} soundVolume={sound.volume} state={state} voiceGender={sound.voiceGender} working={working} />
    <UiDialog
      busy={working}
      danger
      {...(confirmation ? { description: confirmation.kind === "owner-close" ? "进行中的手牌会先完成结算和观察期。" : confirmation.message } : {})}
      onCancel={() => setConfirmation(null)}
      onConfirm={confirmTableAction}
      open={confirmation !== null}
      title={confirmation?.kind === "owner-close" ? "安全关闭房间" : state.room.specialMode === "SQUID" ? "离开鱿鱼牌局" : "退出牌桌"}
    />
    <BuyInModal bigBlind={state.room.bigBlind} maximum={Math.max(1, buyInMaximum)} onClose={() => setBuyInOpen(false)} onConfirm={confirmBuyIn} open={buyInOpen && buyInAllowed} working={working} />
    <ChatDrawer connection={connection} onClose={() => setDrawer(null)} open={drawer === "chat"} roomId={roomId} stateVersion={state.stateVersion} />
    <HistoryDrawer onClose={() => setDrawer(null)} open={drawer === "history"} roomId={roomId} />
  </MobileTableStage>;
}
