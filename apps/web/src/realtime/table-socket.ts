import type {
  ClientToServerEvents,
  CommandAcknowledgement,
  CommandAcknowledgementCallback,
  CommandDataByEvent,
  CommandEventName,
  CommandPayloadByEvent,
  RealtimeError,
  ServerToClientEvents,
} from "@paiyouju/shared";
import { RoomChatHistorySchema, RoomChatMessageSchema } from "@paiyouju/shared";
import { io, type Socket } from "socket.io-client";

import { useTableStore } from "../stores/table-store.js";
import { useNetworkStore } from "../stores/network-store.js";
import { useRoomChatStore } from "../stores/room-chat-store.js";

type TableSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export const TABLE_SOCKET_RECONNECTION_POLICY = {
  randomizationFactor: 0.5,
  reconnectionDelay: 2_000,
  reconnectionDelayMax: 10_000,
} as const;

export type RealtimeClientErrorCode =
  | "REALTIME_DISCONNECTED"
  | "REALTIME_TIMEOUT"
  | "REALTIME_COMMAND_REJECTED";

export class RealtimeClientError extends Error {
  constructor(
    readonly code: RealtimeClientErrorCode,
    message: string,
    readonly serverError?: RealtimeError,
  ) {
    super(message);
    this.name = "RealtimeClientError";
  }
}

type CommandEmitter<E extends CommandEventName> = (
  payload: CommandPayloadByEvent[E],
  acknowledge: CommandAcknowledgementCallback<E>,
) => void;

export interface CommandTransport {
  readonly connected: boolean;
  readonly emitters: { readonly [E in CommandEventName]: CommandEmitter<E> };
}

interface PendingCommand {
  readonly rejectDisconnected: () => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export class CommandAckClient {
  private readonly pending = new Set<PendingCommand>();

  constructor(private readonly transport: CommandTransport) {}

  get pendingCount(): number {
    return this.pending.size;
  }

  emit<E extends CommandEventName>(
    event: E,
    payload: CommandPayloadByEvent[E],
    options: { readonly timeoutMs?: number } = {},
  ): Promise<CommandDataByEvent[E]> {
    if (!this.transport.connected) {
      return Promise.reject(new RealtimeClientError("REALTIME_DISCONNECTED", "网络未连接，操作未发送"));
    }
    const timeoutMs = options.timeoutMs ?? 10_000;
    return new Promise<CommandDataByEvent[E]>((resolve, reject) => {
      let settled = false;
      const settle = (complete: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(pending.timer);
        this.pending.delete(pending);
        complete();
      };
      const pending: PendingCommand = {
        rejectDisconnected: () => settle(() => reject(new RealtimeClientError("REALTIME_DISCONNECTED", "连接已断开，操作结果未知"))),
        timer: setTimeout(() => settle(() => reject(new RealtimeClientError("REALTIME_TIMEOUT", "服务器响应超时，操作结果未知"))), timeoutMs),
      };
      this.pending.add(pending);
      const acknowledge = (result: CommandAcknowledgement<CommandDataByEvent[E]>): void => {
        if (result.ok) {
          settle(() => resolve(result.data));
          return;
        }
        const serverError: RealtimeError = {
          ...result.error,
          requestId: result.requestId,
          ...(result.latestState === undefined ? {} : { latestState: result.latestState }),
          ...(result.stateVersion === undefined ? {} : { stateVersion: result.stateVersion }),
        };
        settle(() => reject(new RealtimeClientError("REALTIME_COMMAND_REJECTED", result.error.message, serverError)));
      };
      this.transport.emitters[event](payload, acknowledge);
    });
  }

  rejectDisconnected(): void {
    for (const command of [...this.pending]) command.rejectDisconnected();
  }
}

function socketTransport(socket: TableSocket): CommandTransport {
  return {
    get connected() { return socket.connected; },
    emitters: {
      "action:submit": (payload, acknowledge) => socket.emit("action:submit", payload, acknowledge),
      "hand:arm-next-action-autopilot": (payload, acknowledge) => socket.emit("hand:arm-next-action-autopilot", payload, acknowledge),
      "hand:cancel-next-action-autopilot": (payload, acknowledge) => socket.emit("hand:cancel-next-action-autopilot", payload, acknowledge),
      "hand:buy-time-extension": (payload, acknowledge) => socket.emit("hand:buy-time-extension", payload, acknowledge),
      "hand:choose-runout-count": (payload, acknowledge) => socket.emit("hand:choose-runout-count", payload, acknowledge),
      "hand:reveal-own-cards": (payload, acknowledge) => socket.emit("hand:reveal-own-cards", payload, acknowledge),
      "room:chat-send": (payload, acknowledge) => socket.emit("room:chat-send", payload, acknowledge),
      "seat:leave": (payload, acknowledge) => socket.emit("seat:leave", payload, acknowledge),
      "seat:reserve-away": (payload, acknowledge) => socket.emit("seat:reserve-away", payload, acknowledge),
      "seat:set-trusteeship": (payload, acknowledge) => socket.emit("seat:set-trusteeship", payload, acknowledge),
      "seat:return": (payload, acknowledge) => socket.emit("seat:return", payload, acknowledge),
      "seat:sit-out": (payload, acknowledge) => socket.emit("seat:sit-out", payload, acknowledge),
      "seat:take": (payload, acknowledge) => socket.emit("seat:take", payload, acknowledge),
      "stack:buy-in": (payload, acknowledge) => socket.emit("stack:buy-in", payload, acknowledge),
      "table:request-state": (payload, acknowledge) => socket.emit("table:request-state", payload, acknowledge),
      "table:start": (payload, acknowledge) => socket.emit("table:start", payload, acknowledge),
      "table:subscribe": (payload, acknowledge) => socket.emit("table:subscribe", payload, acknowledge),
    },
  };
}

class TableSocketClient {
  private commands: CommandAckClient | null = null;
  private roomId: string | null = null;
  private socket: TableSocket | null = null;

  connect(roomId: string): void {
    this.roomId = roomId;
    useRoomChatStore.getState().openRoom(roomId);
    if (this.socket) {
      if (!this.socket.connected) this.socket.connect();
      return;
    }
    const socket = io({
      autoConnect: false,
      ...TABLE_SOCKET_RECONNECTION_POLICY,
      transports: ["websocket"],
      withCredentials: true,
    });
    const commands = new CommandAckClient(socketTransport(socket));
    this.socket = socket;
    this.commands = commands;
    socket.on("connect", () => {
      useTableStore.getState().setConnection("connected");
      useTableStore.getState().invalidateLegalActions();
      const activeRoomId = this.roomId;
      if (!activeRoomId) return;
      void commands.emit("table:subscribe", { roomId: activeRoomId }).then(
        (state) => {
          if (state.room.roomId !== activeRoomId || this.roomId !== activeRoomId) return;
          useTableStore.getState().replaceCanonicalState(state);
        },
        (error: Error) => this.handleClientError(error, true),
      );
    });
    socket.io.on("reconnect_attempt", () => {
      useTableStore.getState().setConnection("reconnecting");
      useTableStore.getState().invalidateLegalActions();
    });
    socket.on("disconnect", () => {
      commands.rejectDisconnected();
      useTableStore.getState().setConnection("disconnected");
      useTableStore.getState().invalidateLegalActions();
    });
    socket.on("connect_error", () => {
      useTableStore.getState().setConnection("disconnected");
      useTableStore.getState().invalidateLegalActions();
    });
    socket.on("table:state", (state) => useTableStore.getState().setState(state));
    socket.on("table:error", (error) => useTableStore.getState().applyError(error));
    socket.on("room:chat-history", (history) => {
      const parsed = RoomChatHistorySchema.safeParse(history);
      if (parsed.success && parsed.data.roomId === this.roomId) useRoomChatStore.getState().replaceHistory(parsed.data);
    });
    socket.on("room:chat-message", (message) => {
      const parsed = RoomChatMessageSchema.safeParse(message);
      if (parsed.success && parsed.data.roomId === this.roomId) useRoomChatStore.getState().receiveMessage(parsed.data);
    });
    useTableStore.getState().setConnection("reconnecting");
    socket.connect();
  }

  disconnect(): void {
    this.roomId = null;
    this.commands?.rejectDisconnected();
    this.socket?.disconnect();
    this.commands = null;
    this.socket = null;
    useTableStore.getState().clear();
    useRoomChatStore.getState().clear();
  }

  async command<E extends Exclude<CommandEventName, "table:subscribe" | "table:request-state">>(
    event: E,
    payload: CommandPayloadByEvent[E],
  ): Promise<CommandDataByEvent[E]> {
    const commands = this.commands;
    if (!commands) throw new RealtimeClientError("REALTIME_DISCONNECTED", "网络未连接，操作未发送");
    useNetworkStore.getState().beginWrite();
    try {
      return await commands.emit(event, payload);
    } catch (error: unknown) {
      this.handleClientError(error instanceof Error ? error : new Error("牌桌命令失败"), event === "action:submit");
      throw error;
    } finally {
      useNetworkStore.getState().endWrite();
    }
  }

  requestState(): void {
    const commands = this.commands;
    if (!commands || !this.roomId) return;
    const requestedRoomId = this.roomId;
    void commands.emit("table:request-state", { roomId: requestedRoomId }).then(
      (state) => {
        if (state.room.roomId !== requestedRoomId || this.roomId !== requestedRoomId) return;
        useTableStore.getState().replaceCanonicalState(state);
      },
      (error: Error) => this.handleClientError(error, false),
    );
  }

  private handleClientError(error: Error, actionMayBeUncertain: boolean): void {
    if (error instanceof RealtimeClientError && error.serverError) {
      useTableStore.getState().applyError(error.serverError);
      return;
    }
    const message = actionMayBeUncertain
      ? "操作结果暂不确定，正在刷新服务器权威状态"
      : error.message;
    useTableStore.getState().applyClientError(message);
    if (actionMayBeUncertain) this.requestState();
  }
}

export const tableSocket = new TableSocketClient();
