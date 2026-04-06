import { randomUUID } from "node:crypto";
import { ACTION_LABEL, STREET_LABEL } from "@poker/shared";
import type {
  AdminAuditLog,
  AdminKickPayload,
  AdminRoomPayload,
  AdminSetChipsPayload,
  AvailableAction,
  Card,
  ChatMessage,
  ChatSendPayload,
  ChipRankingEntry,
  ClientToServerEvents,
  CreateRoomPayload,
  GameActionPayload,
  GameAnimationEvent,
  GameMode,
  GameStreet,
  HandSnapshot,
  JoinRoomPayload,
  PotState,
  ReconnectRoomPayload,
  RoomConfig,
  RoomSettlementSnapshot,
  RoomStatus,
  RoomView,
  SeatTakePayload,
  SeatView,
  ServerToClientEvents,
  SpecialGameResult,
  SocketAck,
  WinnerSummary,
} from "@poker/shared";
import type { Server, Socket } from "socket.io";
import { createDeck, shuffleDeck } from "./cards.js";
import { compareHands, evaluateBestHand } from "./hand-evaluator.js";
import type { AuthenticatedUser } from "./auth.js";
import { Persistence } from "./persistence.js";
import { clamp, createId, generateRoomCode, nowIso } from "./utils.js";
import { calculateRankedRound } from "./ranked-scoring.js";

interface AuthSocketData {
  authUser: AuthenticatedUser;
}

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, AuthSocketData>;
type AppServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, AuthSocketData>;

const NEXT_HAND_DELAY_MS = 2100;

interface PlayerHandState {
  holeCards: Card[];
  folded: boolean;
  allIn: boolean;
  actedThisStreet: boolean;
  committedThisStreet: number;
  totalCommitted: number;
  chipsAtHandStart: number;
}

interface PlayerRecord {
  id: string;
  userId: string;
  email: string | null;
  nickname: string;
  socketId: string | null;
  reconnectToken: string;
  connected: boolean;
  isHost: boolean;
  isAdmin: boolean;
  seatIndex: number | null;
  chips: number;
  pendingStackOverride: number | null;
  pendingKick: boolean;
  hand: PlayerHandState | null;
}

interface HandRecord {
  id: string;
  startedAt: string;
  street: GameStreet;
  deck: Card[];
  communityCards: Card[];
  dealerSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  actionSeatIndex: number | null;
  actionDeadlineAt: string | null;
  currentBet: number;
  lastFullRaise: number;
  minRaiseTo: number | null;
  winners: WinnerSummary[];
  sidePots: PotState[];
  lastAggressiveAction: string;
}

interface RoomRecord {
  roomCode: string;
  status: RoomStatus;
  message: string;
  config: RoomConfig;
  hostPlayerId: string;
  players: Map<string, PlayerRecord>;
  hand: HandRecord | null;
  auditLogs: AdminAuditLog[];
  chatMessages: ChatMessage[];
  specialResult: SpecialGameResult | null;
  latestSettlementSnapshot: RoomSettlementSnapshot | null;
  dealerSeatCursor: number;
  timer: NodeJS.Timeout | null;
  nextHandTimer: NodeJS.Timeout | null;
  pausedRemainingMs: number | null;
}

export class PokerRoomManager {
  private readonly rooms = new Map<string, RoomRecord>();

  constructor(
    private readonly io: AppServer,
    private readonly persistence: Persistence,
  ) {}

  bindSocket(socket: AppSocket): void {
    socket.on("room:create", async (payload: CreateRoomPayload, callback: (ack: SocketAck<RoomView>) => void) => {
      callback(await this.withAck(() => this.createRoom(socket, payload)));
    });
    socket.on("room:join", async (payload: JoinRoomPayload, callback: (ack: SocketAck<RoomView>) => void) => {
      callback(await this.withAck(() => this.joinRoom(socket, payload)));
    });
    socket.on(
      "room:reconnect",
      async (payload: ReconnectRoomPayload, callback: (ack: SocketAck<RoomView>) => void) => {
      callback(await this.withAck(() => this.reconnectRoom(socket, payload)));
      },
    );
    socket.on("seat:take", async (payload: SeatTakePayload, callback: (ack: SocketAck<RoomView>) => void) => {
      callback(await this.withAck(() => this.takeSeat(socket, payload)));
    });
    socket.on("game:start", async (payload: AdminRoomPayload, callback: (ack: SocketAck<RoomView>) => void) => {
      callback(await this.withAck(() => this.startGame(socket, payload)));
    });
    socket.on(
      "game:action",
      async (payload: GameActionPayload, callback: (ack: SocketAck<RoomView>) => void) => {
      callback(await this.withAck(() => this.handleGameAction(socket, payload)));
      },
    );
    socket.on(
      "admin:set_chips",
      async (payload: AdminSetChipsPayload, callback: (ack: SocketAck<RoomView>) => void) => {
      callback(await this.withAck(() => this.setChips(socket, payload)));
      },
    );
    socket.on("admin:pause", async (payload: AdminRoomPayload, callback: (ack: SocketAck<RoomView>) => void) => {
      callback(await this.withAck(() => this.pauseRoom(socket, payload)));
    });
    socket.on("admin:resume", async (payload: AdminRoomPayload, callback: (ack: SocketAck<RoomView>) => void) => {
      callback(await this.withAck(() => this.resumeRoom(socket, payload)));
    });
    socket.on("admin:end_hand", async (payload: AdminRoomPayload, callback: (ack: SocketAck<RoomView>) => void) => {
      callback(await this.withAck(() => this.endHand(socket, payload)));
    });
    socket.on("admin:end_round", async (payload: AdminRoomPayload, callback: (ack: SocketAck<RoomView>) => void) => {
      callback(await this.withAck(() => this.endRound(socket, payload)));
    });
    socket.on("admin:next_round", async (payload: AdminRoomPayload, callback: (ack: SocketAck<RoomView>) => void) => {
      callback(await this.withAck(() => this.nextRound(socket, payload)));
    });
    socket.on(
      "admin:settle_result",
      async (payload: AdminRoomPayload & { note?: string }, callback: (ack: SocketAck<RoomSettlementSnapshot>) => void) => {
        callback(await this.withAck(() => this.settleResult(socket, payload)));
      },
    );
    socket.on("admin:kick", async (payload: AdminKickPayload, callback: (ack: SocketAck<RoomView>) => void) => {
      callback(await this.withAck(() => this.kickPlayer(socket, payload)));
    });
    socket.on("chat:send", async (payload: ChatSendPayload, callback: (ack: SocketAck<RoomView>) => void) => {
      callback(await this.withAck(() => this.sendChat(socket, payload)));
    });
    socket.on("disconnect", () => {
      this.handleDisconnect(socket.id);
    });
  }

  private async withAck<T>(action: () => Promise<T>): Promise<SocketAck<T>> {
    try {
      return { ok: true, data: await action() };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "服务器内部错误",
      };
    }
  }

  private async createRoom(socket: AppSocket, payload: CreateRoomPayload): Promise<RoomView> {
    const authUser = this.getAuthUser(socket);
    const roomCode = generateRoomCode(new Set(this.rooms.keys()));
    const config = this.validateRoomConfig(payload.config);
    const player = this.createPlayer(authUser, this.validateNickname(payload.nickname), config.startingChips, socket.id, true);
    player.seatIndex = Math.floor(config.maxPlayers / 2);
    const room: RoomRecord = {
      roomCode,
      status: "waiting",
      message: `${player.nickname} 已创建房间并自动入座。`,
      config,
      hostPlayerId: player.id,
      players: new Map([[player.id, player]]),
      hand: null,
      auditLogs: [],
      chatMessages: [],
      specialResult: null,
      latestSettlementSnapshot: null,
      dealerSeatCursor: -1,
      timer: null,
      nextHandTimer: null,
      pausedRemainingMs: null,
    };
    this.rooms.set(roomCode, room);
    socket.join(roomCode);
    await this.persistence.saveUserProfile({ userId: player.userId, email: player.email, nickname: player.nickname });
    await this.persistence.saveRoomCreated(roomCode, player.id, player.userId, config);
    await this.persistPlayer(room, player);
    this.pushAudit(room, player.nickname, `创建了房间 ${roomCode}`);
    this.broadcastState(room, room.hand ? "game:state" : "room:state");
    return this.buildRoomView(room, player.id);
  }

  private async joinRoom(socket: AppSocket, payload: JoinRoomPayload): Promise<RoomView> {
    const authUser = this.getAuthUser(socket);
    const room = this.getRoom(payload.roomCode);
    const nickname = this.validateNickname(payload.nickname);
    const existingByUser = [...room.players.values()].find((player) => player.userId === authUser.userId && !player.pendingKick);
    if (existingByUser) {
      if (existingByUser.nickname !== nickname) {
        existingByUser.nickname = nickname;
      }
      existingByUser.email = authUser.email;
      existingByUser.connected = true;
      existingByUser.socketId = socket.id;
      socket.join(room.roomCode);
      room.message = `${existingByUser.nickname} 已重新加入房间。`;
      await this.persistence.saveUserProfile({
        userId: existingByUser.userId,
        email: existingByUser.email,
        nickname: existingByUser.nickname,
      });
      await this.persistPlayer(room, existingByUser);
      this.broadcastState(room, room.hand ? "game:state" : "room:state");
      return this.buildRoomView(room, existingByUser.id);
    }
    if ([...room.players.values()].some((player) => player.nickname === nickname && !player.pendingKick)) {
      throw new Error("该昵称已被占用");
    }
    const player = this.createPlayer(authUser, nickname, room.config.startingChips, socket.id, false);
    room.players.set(player.id, player);
    room.message = `${nickname} 加入了房间。`;
    socket.join(room.roomCode);
    await this.persistence.saveUserProfile({ userId: player.userId, email: player.email, nickname: player.nickname });
    await this.persistPlayer(room, player);
    this.broadcastState(room, "room:state");
    return this.buildRoomView(room, player.id);
  }

  private async reconnectRoom(socket: AppSocket, payload: ReconnectRoomPayload): Promise<RoomView> {
    const authUser = this.getAuthUser(socket);
    const room = this.getRoom(payload.roomCode);
    const player = [...room.players.values()].find((entry) => entry.reconnectToken === payload.reconnectToken);
    if (!player) {
      throw new Error("重连凭证无效");
    }
    if (player.userId !== authUser.userId) {
      throw new Error("该重连凭证不属于当前账号");
    }
    player.connected = true;
    player.socketId = socket.id;
    player.email = authUser.email;
    room.message = `${player.nickname} 已重新连接。`;
    socket.join(room.roomCode);
    this.broadcastState(room, room.hand ? "game:state" : "room:state");
    return this.buildRoomView(room, player.id);
  }

  private async takeSeat(socket: AppSocket, payload: SeatTakePayload): Promise<RoomView> {
    const { room, player } = this.getRoomAndPlayer(socket.id, payload.roomCode);
    if (payload.seatIndex < 0 || payload.seatIndex >= room.config.maxPlayers) {
      throw new Error("座位不存在");
    }
    if (player.seatIndex === payload.seatIndex) {
      return this.buildRoomView(room, player.id);
    }
    if (this.getPlayerBySeat(room, payload.seatIndex)) {
      throw new Error("该座位已经有人");
    }
    if (room.hand && player.seatIndex !== null) {
      throw new Error("手牌进行中，已入座玩家不能切换座位");
    }
    if (room.hand && !room.config.allowMidHandJoin) {
      throw new Error("当前房间不允许牌局进行中入座");
    }
    player.seatIndex = payload.seatIndex;
    room.message = `${player.nickname} 坐到了 ${payload.seatIndex + 1} 号位。`;
    await this.persistPlayer(room, player);
    this.broadcastState(room, "room:state");
    return this.buildRoomView(room, player.id);
  }

  private async startGame(socket: AppSocket, payload: AdminRoomPayload): Promise<RoomView> {
    const { room, player } = this.getRoomAndPlayer(socket.id, payload.roomCode);
    this.assertHost(room, player);
    this.clearNextHandTimer(room);
    if (room.specialResult) {
      throw new Error("本大局已结算，请点击“继续下一大局”重置筹码后开始");
    }
    if (room.hand) {
      throw new Error("当前已有手牌在进行中");
    }
    await this.beginHand(room);
    return this.buildRoomView(room, player.id);
    /*
    const participants = this.getSeatedPlayers(room).filter((entry) => entry.chips > 0 && !entry.pendingKick);
    if (participants.length < 2) {
      throw new Error("至少需要两名入座玩家且带有筹码");
    }
    const dealerSeat =
      this.findNextOccupiedSeat(room, room.dealerSeatCursor, (entry) => entry.chips > 0 && !entry.pendingKick) ??
      participants[0].seatIndex!;
    room.dealerSeatCursor = dealerSeat;
    const isHeadsUp = participants.length === 2;
    const smallBlindSeat = dealerSeat;
    const bigBlindSeat =
      this.findNextOccupiedSeat(room, smallBlindSeat, (entry) => entry.chips > 0 && !entry.pendingKick) ?? dealerSeat;
    const deck = shuffleDeck(createDeck());

    for (const seated of this.getSeatedPlayers(room)) {
      seated.hand =
        seated.chips > 0 && !seated.pendingKick
          ? {
              holeCards: [deck.shift() as Card, deck.shift() as Card],
              folded: false,
              allIn: false,
              actedThisStreet: false,
              committedThisStreet: 0,
              totalCommitted: 0,
              chipsAtHandStart: seated.chips,
            }
          : null;
    }

    room.hand = {
      id: createId("hand"),
      startedAt: nowIso(),
      street: "preflop",
      deck,
      communityCards: [],
      dealerSeat,
      smallBlindSeat,
      bigBlindSeat,
      actionSeatIndex: null,
      actionDeadlineAt: null,
      currentBet: 0,
      lastFullRaise: room.config.bigBlind,
      minRaiseTo: room.config.bigBlind * 2,
      winners: [],
      sidePots: [],
      lastAggressiveAction: "新一手牌开始",
    };
    room.specialResult = null;
    room.latestSettlementSnapshot = null;

    this.postForcedBet(room, smallBlindSeat, room.config.smallBlind);
    this.postForcedBet(room, bigBlindSeat, room.config.bigBlind);
    room.hand.currentBet = room.config.bigBlind;
    room.hand.minRaiseTo = room.config.bigBlind * 2;
    room.hand.actionSeatIndex = isHeadsUp
      ? dealerSeat
      : this.findNextOccupiedSeat(room, bigBlindSeat, (entry) => this.isActiveParticipant(entry));
    room.status = "running";
    const smallBlindPlayer = this.getPlayerBySeat(room, smallBlindSeat);
    const bigBlindPlayer = this.getPlayerBySeat(room, bigBlindSeat);
    room.message = `新一手开始：${smallBlindPlayer?.nickname ?? "小盲"} 为小盲，${bigBlindPlayer?.nickname ?? "大盲"} 为大盲`;
    room.message = `新一手牌开始，当前阶段：${STREET_LABEL.preflop}`;
    room.message = `新一手开始：${smallBlindPlayer?.nickname ?? "小盲"} 为小盲，${bigBlindPlayer?.nickname ?? "大盲"} 为大盲`;
    await this.persistence.saveHandStarted({
      handId: room.hand.id,
      roomCode: room.roomCode,
      street: room.hand.street,
      communityCards: room.hand.communityCards,
      startedAt: room.hand.startedAt,
    });
    this.emitAnimation(room, { kind: "deal_hole", payload: { handId: room.hand.id } });
    this.scheduleTurnTimeout(room);
    this.broadcastState(room, "game:state");
    return this.buildRoomView(room, player.id);
    */
  }

  private async handleGameAction(socket: AppSocket, payload: GameActionPayload): Promise<RoomView> {
    const { room, player } = this.getRoomAndPlayer(socket.id, payload.roomCode);
    if (room.status !== "running" || !room.hand) {
      throw new Error("当前没有进行中的牌局");
    }
    if (room.hand.actionSeatIndex !== player.seatIndex) {
      throw new Error("还没轮到你行动");
    }
    if (!player.hand) {
      throw new Error("当前手牌中没有你的数据");
    }
    await this.applyAction(room, player, payload.action.type, payload.action.amount ?? null);
    this.broadcastState(room, room.hand ? "game:state" : "game:result");
    return this.buildRoomView(room, player.id);
  }

  private async setChips(socket: AppSocket, payload: AdminSetChipsPayload): Promise<RoomView> {
    const { room, player } = this.getRoomAndPlayer(socket.id, payload.roomCode);
    this.assertAdmin(player);
    const target = room.players.get(payload.targetPlayerId);
    if (!target) {
      throw new Error("目标玩家不存在");
    }
    const nextValue = Math.max(0, Math.floor(payload.chips));
    const beforeValue = target.pendingStackOverride ?? target.chips;
    if (room.hand && target.hand?.allIn) {
      target.pendingStackOverride = nextValue;
    } else {
      target.chips = nextValue;
    }
    await this.persistPlayer(room, target);
    await this.persistence.saveChipAdjustment({
      roomCode: room.roomCode,
      handId: room.hand?.id ?? null,
      actorPlayerId: player.id,
      actorUserId: player.userId,
      targetPlayerId: target.id,
      targetUserId: target.userId,
      beforeValue,
      afterValue: nextValue,
    });
    room.message = `管理员已调整 ${target.nickname} 的筹码：${beforeValue} -> ${nextValue}`;
    this.pushAudit(room, player.nickname, room.message);
    this.broadcastState(room, room.hand ? "game:state" : "room:state");
    return this.buildRoomView(room, player.id);
  }

  private async pauseRoom(socket: AppSocket, payload: AdminRoomPayload): Promise<RoomView> {
    const { room, player } = this.getRoomAndPlayer(socket.id, payload.roomCode);
    this.assertAdmin(player);
    if (room.status !== "running") {
      throw new Error("当前房间不在进行中");
    }
    room.status = "paused";
    if (room.hand?.actionDeadlineAt) {
      room.pausedRemainingMs = Math.max(0, new Date(room.hand.actionDeadlineAt).getTime() - Date.now());
      room.hand.actionDeadlineAt = null;
    }
    this.clearTimer(room);
    room.message = "房主已暂停牌局。";
    this.pushAudit(room, player.nickname, "暂停了牌局");
    this.broadcastState(room, "room:state");
    return this.buildRoomView(room, player.id);
  }

  private async resumeRoom(socket: AppSocket, payload: AdminRoomPayload): Promise<RoomView> {
    const { room, player } = this.getRoomAndPlayer(socket.id, payload.roomCode);
    this.assertAdmin(player);
    if (room.status !== "paused") {
      throw new Error("房间当前不是暂停状态");
    }
    room.status = room.hand ? "running" : "waiting";
    room.message = room.hand ? "牌局已恢复，请继续行动。" : "房间已恢复。";
    this.pushAudit(room, player.nickname, "恢复了牌局");
    if (room.hand?.actionSeatIndex !== null) {
      this.scheduleTurnTimeout(room, room.pausedRemainingMs ?? undefined);
      room.pausedRemainingMs = null;
    }
    this.broadcastState(room, room.hand ? "game:state" : "room:state");
    return this.buildRoomView(room, player.id);
  }

  private async endHand(socket: AppSocket, payload: AdminRoomPayload): Promise<RoomView> {
    const { room, player } = this.getRoomAndPlayer(socket.id, payload.roomCode);
    this.assertAdmin(player);
    if (!room.hand) {
      throw new Error("当前没有进行中的手牌");
    }
    for (const participant of this.getParticipants(room)) {
      if (!participant.hand) {
        continue;
      }
      participant.chips += participant.hand.totalCommitted;
      participant.hand = null;
      if (participant.pendingStackOverride !== null) {
        participant.chips = participant.pendingStackOverride;
        participant.pendingStackOverride = null;
      }
      await this.persistPlayer(room, participant);
    }
    room.message = "管理员已结束当前手牌，并退回本手已投入筹码。";
    this.pushAudit(room, player.nickname, "结束了当前手牌");
    room.hand = null;
    room.status = "waiting";
    this.clearTimer(room);
    this.removeKickedPlayers(room);
    this.broadcastState(room, "room:state");
    return this.buildRoomView(room, player.id);
  }

  private async kickPlayer(socket: AppSocket, payload: AdminKickPayload): Promise<RoomView> {
    const { room, player } = this.getRoomAndPlayer(socket.id, payload.roomCode);
    this.assertAdmin(player);
    const target = room.players.get(payload.targetPlayerId);
    if (!target) {
      throw new Error("目标玩家不存在");
    }
    if (target.isHost) {
      throw new Error("不能踢出房主");
    }
    if (room.hand && target.hand && !target.hand.folded) {
      target.hand.folded = true;
      target.pendingKick = true;
      room.message = `管理员将在本手结束后将 ${target.nickname} 移出房间。`;
      this.pushAudit(room, player.nickname, room.message);
      await this.checkForHandCompletion(room);
    } else {
      room.players.delete(target.id);
      room.message = `管理员已将 ${target.nickname} 请出房间。`;
      this.pushAudit(room, player.nickname, room.message);
    }
    this.broadcastState(room, room.hand ? "game:state" : "room:state");
    return this.buildRoomView(room, player.id);
  }

  private async sendChat(socket: AppSocket, payload: ChatSendPayload): Promise<RoomView> {
    const { room, player } = this.getRoomAndPlayer(socket.id, payload.roomCode);
    const text = payload.text.trim().slice(0, 100);
    if (!text) {
      throw new Error("聊天内容不能为空");
    }
    const message: ChatMessage = {
      id: createId("chat"),
      roomCode: room.roomCode,
      playerId: player.id,
      userId: player.userId,
      nickname: player.nickname,
      text,
      createdAt: nowIso(),
    };
    room.chatMessages = [...room.chatMessages.slice(-29), message];
    await this.persistence.saveChatMessage(message, player.userId);
    this.io.to(room.roomCode).emit("chat:message", message);
    this.broadcastState(room, room.hand ? "game:state" : "room:state");
    return this.buildRoomView(room, player.id);
  }

  private async applyAction(
    room: RoomRecord,
    player: PlayerRecord,
    actionType: GameActionPayload["action"]["type"],
    amount: number | null,
  ): Promise<void> {
    const hand = room.hand;
    if (!hand || !player.hand) {
      throw new Error("当前没有可处理的动作");
    }
    const available = this.getAvailableActions(room, player);
    if (!available.some((entry) => entry.type === actionType)) {
      throw new Error("当前动作不合法");
    }
    const toCall = Math.max(0, hand.currentBet - player.hand.committedThisStreet);
    this.clearTimer(room);
    let moved = 0;

    if (actionType === "fold") {
      player.hand.folded = true;
      player.hand.actedThisStreet = true;
      room.message = `${player.nickname} 选择弃牌。`;
    } else if (actionType === "check") {
      if (toCall !== 0) {
        throw new Error("当前不能过牌");
      }
      player.hand.actedThisStreet = true;
      room.message = `${player.nickname} 选择过牌。`;
    } else if (actionType === "call") {
      if (toCall <= 0) {
        throw new Error("当前无需跟注");
      }
      moved = this.commitChips(player, toCall);
      player.hand.actedThisStreet = true;
      room.message =
        moved < toCall
          ? `${player.nickname} 跟注并全下 ${moved}。`
          : `${player.nickname} 跟注 ${moved}。`;
    } else if (actionType === "raise") {
      if (amount === null) {
        throw new Error("加注需要指定目标额");
      }
      const targetTotal = Math.floor(amount);
      const minRaiseTo = hand.minRaiseTo ?? hand.currentBet + hand.lastFullRaise;
      const maxTotal = player.hand.committedThisStreet + player.chips;
      if (targetTotal <= hand.currentBet) {
        throw new Error("加注额必须大于当前下注");
      }
      if (targetTotal > maxTotal) {
        throw new Error("筹码不足");
      }
      if (targetTotal < minRaiseTo) {
        throw new Error(`最小加注到 ${minRaiseTo}`);
      }
      moved = this.commitChips(player, targetTotal - player.hand.committedThisStreet);
      const raiseSize = targetTotal - hand.currentBet;
      hand.currentBet = targetTotal;
      hand.lastFullRaise = raiseSize;
      hand.minRaiseTo = hand.currentBet + hand.lastFullRaise;
      player.hand.actedThisStreet = true;
      this.resetOthersToRespond(room, player.id);
      room.message = `${player.nickname} 加注到 ${targetTotal}。`;
      hand.lastAggressiveAction = room.message;
    } else if (actionType === "all_in") {
      const totalTarget = player.hand.committedThisStreet + player.chips;
      if (totalTarget <= player.hand.committedThisStreet) {
        throw new Error("当前没有可全下的筹码");
      }
      moved = this.commitChips(player, player.chips);
      player.hand.actedThisStreet = true;
      player.hand.allIn = true;
      if (totalTarget > hand.currentBet) {
        const raiseSize = totalTarget - hand.currentBet;
        hand.currentBet = totalTarget;
        if (raiseSize >= hand.lastFullRaise) {
          hand.lastFullRaise = raiseSize;
          hand.minRaiseTo = hand.currentBet + hand.lastFullRaise;
          this.resetOthersToRespond(room, player.id);
        }
        hand.lastAggressiveAction = `${player.nickname} 全下到 ${totalTarget}`;
      }
      room.message = `${player.nickname} 选择全下，总下注到 ${totalTarget}。`;
    }

    hand.sidePots = this.computeSidePots(room);
    this.emitAnimation(room, {
      kind: "chips_to_pot",
      payload: { handId: hand.id, playerId: player.id, amount: moved },
    });
    await this.persistence.saveHandAction({
      handId: hand.id,
      roomCode: room.roomCode,
      playerId: player.id,
      userId: player.userId,
      nickname: player.nickname,
      street: hand.street,
      actionType,
      amount: amount ?? moved,
    });
    await this.checkForHandCompletion(room, player.seatIndex ?? undefined);
  }

  private async checkForHandCompletion(room: RoomRecord, lastSeat?: number): Promise<void> {
    const hand = room.hand;
    if (!hand) {
      return;
    }
    const contenders = this.getParticipants(room).filter((entry) => entry.hand && !entry.hand.folded);
    if (contenders.length <= 1) {
      const winner = contenders[0];
      if (!winner) {
        return;
      }
      this.refundUncalledBet(room);
      const totalPot = this.getTotalPot(room);
      if (winner.pendingStackOverride !== null) {
        winner.chips = winner.pendingStackOverride;
        winner.pendingStackOverride = null;
      }
      winner.chips += totalPot;
      hand.winners = [
        {
          playerId: winner.id,
          nickname: winner.nickname,
          amount: totalPot,
          handDescription: "鍏朵粬鐜╁宸插叏閮ㄥ純鐗岋紝鐩存帴鏀朵笅搴曟睜",
          bestFiveCards: [],
          handName: "对手全部弃牌",
        },
      ];
      await this.finishHand(room);
      return;
    }

    const activeToAct = contenders.filter((entry) => entry.hand && !entry.hand.allIn);
    if (activeToAct.length === 0) {
      await this.runShowdown(room);
      return;
    }
    if (this.isStreetComplete(room)) {
      await this.advanceStreet(room);
      return;
    }
    hand.actionSeatIndex = this.findNextOccupiedSeat(
      room,
      lastSeat ?? hand.actionSeatIndex ?? hand.bigBlindSeat,
      (entry) => this.isActiveParticipant(entry) && !entry.hand?.folded && !entry.hand?.allIn,
    );
    this.scheduleTurnTimeout(room);
  }

  private isStreetComplete(room: RoomRecord): boolean {
    const hand = room.hand;
    if (!hand) {
      return true;
    }
    const pendingPlayers = this.getParticipants(room).filter((entry) => entry.hand && !entry.hand.folded && !entry.hand.allIn);
    if (!pendingPlayers.length) {
      return true;
    }
    return pendingPlayers.every(
      (entry) => Boolean(entry.hand?.actedThisStreet) && entry.hand?.committedThisStreet === hand.currentBet,
    );
  }

  private async advanceStreet(room: RoomRecord): Promise<void> {
    const hand = room.hand;
    if (!hand) {
      return;
    }
    if (hand.street === "river") {
      await this.runShowdown(room);
      return;
    }
    if (hand.street === "preflop") {
      hand.street = "flop";
      hand.communityCards.push(hand.deck.shift() as Card, hand.deck.shift() as Card, hand.deck.shift() as Card);
      this.emitAnimation(room, { kind: "reveal_flop", payload: { cards: hand.communityCards, handId: hand.id } });
    } else if (hand.street === "flop") {
      hand.street = "turn";
      hand.communityCards.push(hand.deck.shift() as Card);
      this.emitAnimation(room, { kind: "reveal_turn", payload: { card: hand.communityCards[3], handId: hand.id } });
    } else if (hand.street === "turn") {
      hand.street = "river";
      hand.communityCards.push(hand.deck.shift() as Card);
      this.emitAnimation(room, { kind: "reveal_river", payload: { card: hand.communityCards[4], handId: hand.id } });
    }
    for (const participant of this.getParticipants(room)) {
      if (!participant.hand) {
        continue;
      }
      participant.hand.committedThisStreet = 0;
      participant.hand.actedThisStreet = false;
    }
    hand.currentBet = 0;
    hand.lastFullRaise = room.config.bigBlind;
    hand.minRaiseTo = room.config.bigBlind;
    hand.actionSeatIndex = this.findNextOccupiedSeat(
      room,
      hand.dealerSeat,
      (entry) => this.isActiveParticipant(entry) && !entry.hand?.folded && !entry.hand?.allIn,
    );
    room.message = `进入${STREET_LABEL[hand.street]}阶段。`;
    this.scheduleTurnTimeout(room);
    this.broadcastState(room, "game:state");
  }

  private async runShowdown(room: RoomRecord): Promise<void> {
    const hand = room.hand;
    if (!hand) {
      return;
    }
    while (hand.communityCards.length < 5) {
      hand.communityCards.push(hand.deck.shift() as Card);
    }
    hand.street = "showdown";
    this.refundUncalledBet(room);
    hand.sidePots = this.computeSidePots(room);
    const eligible = this.getParticipants(room).filter((entry) => entry.hand && !entry.hand.folded);
    const evaluations = new Map<string, ReturnType<typeof evaluateBestHand>>();

    for (const player of eligible) {
      evaluations.set(player.id, evaluateBestHand([...player.hand!.holeCards, ...hand.communityCards]));
      if (player.pendingStackOverride !== null) {
        player.chips = player.pendingStackOverride;
        player.pendingStackOverride = null;
      }
    }

    const winnerMap = new Map<string, WinnerSummary>();
    for (const pot of hand.sidePots) {
      const potPlayers = eligible.filter((entry) => pot.eligiblePlayerIds.includes(entry.id));
      if (!potPlayers.length) {
        continue;
      }
      let best = evaluations.get(potPlayers[0].id)!;
      let bestPlayers = [potPlayers[0]];
      for (let index = 1; index < potPlayers.length; index += 1) {
        const player = potPlayers[index];
        const current = evaluations.get(player.id)!;
        const comparison = compareHands(current, best);
        if (comparison > 0) {
          best = current;
          bestPlayers = [player];
        } else if (comparison === 0) {
          bestPlayers.push(player);
        }
      }

      const ordered = [...bestPlayers].sort((left, right) => {
        const leftDistance = this.relativeSeatDistance(hand.dealerSeat, left.seatIndex ?? 0, room.config.maxPlayers);
        const rightDistance = this.relativeSeatDistance(hand.dealerSeat, right.seatIndex ?? 0, room.config.maxPlayers);
        return leftDistance - rightDistance;
      });
      const share = Math.floor(pot.amount / ordered.length);
      let remainder = pot.amount % ordered.length;
      for (const winner of ordered) {
        const amount = share + (remainder > 0 ? 1 : 0);
        remainder = Math.max(0, remainder - 1);
        winner.chips += amount;
        const evaluation = evaluations.get(winner.id);
        const existing = winnerMap.get(winner.id);
        if (existing) {
          existing.amount += amount;
          continue;
        }
        winnerMap.set(winner.id, {
          playerId: winner.id,
          nickname: winner.nickname,
          amount,
          handDescription: evaluation?.description ?? "鏈煡鐗屽瀷",
          bestFiveCards: evaluation?.bestFiveCards ?? [],
          handName: evaluations.get(winner.id)?.name ?? "高牌",
        });
      }
    }

    const winners = [...winnerMap.values()].sort((left, right) => {
      if (right.amount !== left.amount) {
        return right.amount - left.amount;
      }
      return left.nickname.localeCompare(right.nickname);
    });
    hand.winners = winners;
    room.message = winners.length
      ? `本手结束：${winners.map((entry) => `${entry.nickname} 赢得 ${entry.amount}`).join("，")}`
      : "本手结束。";
    this.emitAnimation(room, { kind: "showdown", payload: { handId: hand.id, cards: hand.communityCards } });
    this.emitAnimation(room, { kind: "award_pot", payload: { handId: hand.id, winners } });
    await this.finishHand(room);
  }

  private async finishHand(room: RoomRecord): Promise<void> {
    const hand = room.hand;
    if (!hand) {
      return;
    }
    hand.actionSeatIndex = null;
    hand.actionDeadlineAt = null;
    this.clearTimer(room);
    room.specialResult = null;
    room.latestSettlementSnapshot = null;
    const participants = this.getParticipants(room);
    await this.persistence.saveHandResult({
      handId: hand.id,
      roomCode: room.roomCode,
      street: hand.street,
      communityCards: hand.communityCards,
      winners: hand.winners,
    });
    for (const participant of participants) {
      if (!participant.hand) {
        continue;
      }
      const winner = hand.winners.find((entry) => entry.playerId === participant.id);
      const wonAmount = winner?.amount ?? 0;
      const endChips = participant.pendingStackOverride ?? participant.chips;
      const deltaChips = endChips - participant.hand.chipsAtHandStart;
      await this.persistence.saveHandPlayerResult({
        handId: hand.id,
        roomCode: room.roomCode,
        userId: participant.userId,
        playerId: participant.id,
        nickname: participant.nickname,
        chipsAtHandStart: participant.hand.chipsAtHandStart,
        endChips,
        deltaChips,
        wonAmount,
        isWinner: wonAmount > 0,
        winningHandName: winner?.handName ?? null,
      });
      await this.persistence.saveUserStatsDelta({
        userId: participant.userId,
        handsPlayedInc: 1,
        handsWonInc: wonAmount > 0 ? 1 : 0,
        netChipsInc: deltaChips,
      });
    }
    for (const participant of participants) {
      participant.hand = null;
    }
    const busted = this.getSeatedPlayers(room).some((entry) => entry.chips === 0 && !entry.pendingKick);
    if (busted) {
      await this.settleRound(room, "bankrupt");
      room.status = "ended";
    } else {
      for (const participant of participants) {
        await this.persistPlayer(room, participant);
      }
      room.status = "waiting";
    }
    this.broadcastState(room, "game:result");
    this.removeKickedPlayers(room);
    room.hand = null;
    if (!busted) {
      this.scheduleAutoNextHand(room);
    }
  }

  private scheduleAutoNextHand(room: RoomRecord): void {
    this.clearNextHandTimer(room);
    if (room.status !== "waiting") {
      return;
    }
    const participants = this.getSeatedPlayers(room).filter((entry) => entry.chips > 0 && !entry.pendingKick);
    if (participants.length < 2) {
      return;
    }
    room.nextHandTimer = setTimeout(() => {
      void this.startNextHandAutomatically(room.roomCode);
    }, NEXT_HAND_DELAY_MS);
  }

  private async startNextHandAutomatically(roomCode: string): Promise<void> {
    const room = this.rooms.get(roomCode);
    if (!room || room.hand || room.status !== "waiting") {
      return;
    }
    const participants = this.getSeatedPlayers(room).filter((entry) => entry.chips > 0 && !entry.pendingKick);
    if (participants.length < 2) {
      return;
    }
    this.clearNextHandTimer(room);
    await this.beginHand(room);
    return;
    /*
    const dealerSeat =
      this.findNextOccupiedSeat(room, room.dealerSeatCursor, (entry) => entry.chips > 0 && !entry.pendingKick) ??
      participants[0].seatIndex!;
    room.dealerSeatCursor = dealerSeat;
    const isHeadsUp = participants.length === 2;
    const smallBlindSeat = dealerSeat;
    const bigBlindSeat =
      this.findNextOccupiedSeat(room, smallBlindSeat, (entry) => entry.chips > 0 && !entry.pendingKick) ?? dealerSeat;
    const deck = shuffleDeck(createDeck());

    for (const seated of this.getSeatedPlayers(room)) {
      seated.hand =
        seated.chips > 0 && !seated.pendingKick
          ? {
              holeCards: [deck.shift() as Card, deck.shift() as Card],
              folded: false,
              allIn: false,
              actedThisStreet: false,
              committedThisStreet: 0,
              totalCommitted: 0,
              chipsAtHandStart: seated.chips,
            }
          : null;
    }

    room.hand = {
      id: createId("hand"),
      startedAt: nowIso(),
      street: "preflop",
      deck,
      communityCards: [],
      dealerSeat,
      smallBlindSeat,
      bigBlindSeat,
      actionSeatIndex: null,
      actionDeadlineAt: null,
      currentBet: 0,
      lastFullRaise: room.config.bigBlind,
      minRaiseTo: room.config.bigBlind * 2,
      winners: [],
      sidePots: [],
      lastAggressiveAction: "新一手牌开始",
    };
    room.specialResult = null;
    room.latestSettlementSnapshot = null;
    this.postForcedBet(room, smallBlindSeat, room.config.smallBlind);
    this.postForcedBet(room, bigBlindSeat, room.config.bigBlind);
    room.hand.currentBet = room.config.bigBlind;
    room.hand.minRaiseTo = room.config.bigBlind * 2;
    room.hand.actionSeatIndex = isHeadsUp
      ? dealerSeat
      : this.findNextOccupiedSeat(room, bigBlindSeat, (entry) => this.isActiveParticipant(entry));
    room.status = "running";
    const smallBlindPlayer = this.getPlayerBySeat(room, smallBlindSeat);
    const bigBlindPlayer = this.getPlayerBySeat(room, bigBlindSeat);
    room.message = `新一手开始：${smallBlindPlayer?.nickname ?? "小盲"} 为小盲，${bigBlindPlayer?.nickname ?? "大盲"} 为大盲`;
    await this.persistence.saveHandStarted({
      handId: room.hand.id,
      roomCode: room.roomCode,
      street: room.hand.street,
      communityCards: room.hand.communityCards,
      startedAt: room.hand.startedAt,
    });
    this.emitAnimation(room, { kind: "deal_hole", payload: { handId: room.hand.id } });
    this.scheduleTurnTimeout(room);
    this.broadcastState(room, "game:state");
    */
  }

  private async beginHand(room: RoomRecord): Promise<void> {
    const participants = this.getSeatedPlayers(room).filter((entry) => entry.chips > 0 && !entry.pendingKick);
    if (participants.length < 2) {
      throw new Error("至少需要两名入座玩家且带有筹码");
    }

    const dealerSeat =
      this.findNextOccupiedSeat(room, room.dealerSeatCursor, (entry) => entry.chips > 0 && !entry.pendingKick) ??
      participants[0].seatIndex!;
    room.dealerSeatCursor = dealerSeat;

    const isHeadsUp = participants.length === 2;
    const smallBlindSeat = dealerSeat;
    const bigBlindSeat =
      this.findNextOccupiedSeat(room, smallBlindSeat, (entry) => entry.chips > 0 && !entry.pendingKick) ?? dealerSeat;
    const deck = shuffleDeck(createDeck());

    for (const seated of this.getSeatedPlayers(room)) {
      seated.hand =
        seated.chips > 0 && !seated.pendingKick
          ? {
              holeCards: [deck.shift() as Card, deck.shift() as Card],
              folded: false,
              allIn: false,
              actedThisStreet: false,
              committedThisStreet: 0,
              totalCommitted: 0,
              chipsAtHandStart: seated.chips,
            }
          : null;
    }

    room.hand = {
      id: createId("hand"),
      startedAt: nowIso(),
      street: "preflop",
      deck,
      communityCards: [],
      dealerSeat,
      smallBlindSeat,
      bigBlindSeat,
      actionSeatIndex: null,
      actionDeadlineAt: null,
      currentBet: 0,
      lastFullRaise: room.config.bigBlind,
      minRaiseTo: room.config.bigBlind * 2,
      winners: [],
      sidePots: [],
      lastAggressiveAction: "排位赛新一手开始",
    };
    room.specialResult = null;
    room.latestSettlementSnapshot = null;

    this.postForcedBet(room, smallBlindSeat, room.config.smallBlind);
    this.postForcedBet(room, bigBlindSeat, room.config.bigBlind);
    room.hand.currentBet = room.config.bigBlind;
    room.hand.minRaiseTo = room.config.bigBlind * 2;
    room.hand.actionSeatIndex = isHeadsUp
      ? dealerSeat
      : this.findNextOccupiedSeat(room, bigBlindSeat, (entry) => this.isActiveParticipant(entry));
    room.status = "running";

    const smallBlindPlayer = this.getPlayerBySeat(room, smallBlindSeat);
    const bigBlindPlayer = this.getPlayerBySeat(room, bigBlindSeat);
    room.message = `排位赛手牌开始：${smallBlindPlayer?.nickname ?? "小盲"} 是小盲，${bigBlindPlayer?.nickname ?? "大盲"} 是大盲。`;

    await this.persistence.saveHandStarted({
      handId: room.hand.id,
      roomCode: room.roomCode,
      street: room.hand.street,
      communityCards: room.hand.communityCards,
      startedAt: room.hand.startedAt,
    });
    this.emitAnimation(room, { kind: "deal_hole", payload: { handId: room.hand.id } });
    this.scheduleTurnTimeout(room);
    this.broadcastState(room, "game:state");
  }

  private buildSpecialGameResult(room: RoomRecord, trigger: "bankrupt" | "manual"): SpecialGameResult {
    const rankedPlayers = this.getSeatedPlayers(room).filter((entry) => !entry.pendingKick);
    const waterUpCount = rankedPlayers.filter((entry) => entry.chips > 1000).length;
    const bankruptCount = rankedPlayers.filter((entry) => entry.chips === 0).length;
    const canScore = rankedPlayers.length >= 4 && rankedPlayers.length <= 7;
    const rankings = canScore
      ? calculateRankedRound(
          rankedPlayers.map((entry) => ({
            playerId: entry.id,
            userId: entry.userId,
            nickname: entry.nickname,
            chips: entry.chips,
          })),
        ).rankings
      : [...rankedPlayers]
          .sort((left, right) => {
            if (right.chips !== left.chips) {
              return right.chips - left.chips;
            }
            return left.nickname.localeCompare(right.nickname);
          })
          .map((entry, index) => ({
            playerId: entry.id,
            userId: entry.userId,
            nickname: entry.nickname,
            chips: entry.chips,
            rank: index + 1,
            isTied: false,
            rankPoints: 0,
            chipPoints: 0,
            bankruptPenalty: 0,
            championBonus: 0,
            totalPoints: 0,
          }));

    return {
      mode: "ranked",
      trigger,
      isScored: canScore,
      roomCode: room.roomCode,
      roundId: createId("round"),
      settledAt: nowIso(),
      reason: canScore
        ? trigger === "bankrupt"
          ? "有人破产，本大局结算完成"
          : "房主手动结束大局，结算完成"
        : "当前人数少于4人，本大局仅重置筹码不计分",
      waterUpCount,
      bankruptCount,
      rankings,
    };
  }

  private async resetAllPlayersToStartingChips(room: RoomRecord): Promise<void> {
    for (const player of room.players.values()) {
      player.chips = room.config.startingChips;
      player.pendingStackOverride = null;
      await this.persistPlayer(room, player);
    }
  }

  private async settleRound(room: RoomRecord, trigger: "bankrupt" | "manual"): Promise<void> {
    const specialResult = this.buildSpecialGameResult(room, trigger);
    room.specialResult = specialResult;
    room.message = `${specialResult.reason}，请房主选择继续下一大局或结算结果。`;

    if (specialResult.isScored) {
      try {
        await this.persistence.saveRankedRoundResult({
          roomCode: room.roomCode,
          roundId: specialResult.roundId,
          triggerType: specialResult.trigger,
          settledAt: specialResult.settledAt,
          waterUpCount: specialResult.waterUpCount,
          bankruptCount: specialResult.bankruptCount,
          rankings: specialResult.rankings,
        });
      } catch (error) {
        console.error("saveRankedRoundResult failed:", error);
        room.message = `${specialResult.reason}（数据库连接异常，当前仅本局展示，排行榜暂未落库）`;
      }
    }
    for (const participant of this.getParticipants(room)) {
      await this.persistPlayer(room, participant);
    }
  }

  private async endRound(socket: AppSocket, payload: AdminRoomPayload): Promise<RoomView> {
    const { room, player } = this.getRoomAndPlayer(socket.id, payload.roomCode);
    this.assertHost(room, player);

    if (room.hand) {
      for (const participant of this.getParticipants(room)) {
        if (!participant.hand) {
          continue;
        }
        participant.chips += participant.hand.totalCommitted;
        participant.hand = null;
        if (participant.pendingStackOverride !== null) {
          participant.chips = participant.pendingStackOverride;
          participant.pendingStackOverride = null;
        }
      }
      room.hand = null;
      this.clearTimer(room);
    }

    await this.settleRound(room, "manual");
    room.status = "ended";
    this.clearNextHandTimer(room);
    this.broadcastState(room, "game:result");
    return this.buildRoomView(room, player.id);
  }

  private async nextRound(socket: AppSocket, payload: AdminRoomPayload): Promise<RoomView> {
    const { room, player } = this.getRoomAndPlayer(socket.id, payload.roomCode);
    this.assertHost(room, player);
    if (room.hand) {
      throw new Error("当前仍有手牌在进行中");
    }
    await this.resetAllPlayersToStartingChips(room);
    room.specialResult = null;
    room.latestSettlementSnapshot = null;
    room.status = "waiting";
    const readyPlayers = this.getSeatedPlayers(room).filter((entry) => entry.chips > 0 && !entry.pendingKick);
    if (readyPlayers.length >= 2) {
      await this.beginHand(room);
    } else {
      room.message = "已重置筹码到1000。当前不足2人，等待更多玩家后再开局。";
      this.broadcastState(room, "room:state");
    }
    return this.buildRoomView(room, player.id);
  }

  private async settleResult(
    socket: AppSocket,
    payload: AdminRoomPayload & { note?: string },
  ): Promise<RoomSettlementSnapshot> {
    const { room, player } = this.getRoomAndPlayer(socket.id, payload.roomCode);
    this.assertHost(room, player);
    const snapshotId = createId("snapshot");
    const note = (payload.note ?? "").trim().slice(0, 120);
    try {
      await this.persistence.createRoomSettlementSnapshot({
        snapshotId,
        roomCode: room.roomCode,
        note,
        createdByUserId: player.userId,
      });
      const leaderboard = await this.persistence.listRoomLeaderboard(room.roomCode, 200);
      for (const entry of leaderboard) {
        const details = await this.persistence.listRoomRoundDetails(room.roomCode, entry.userId);
        await this.persistence.saveRoomSettlementEntry({
          snapshotId,
          roomCode: room.roomCode,
          userId: entry.userId,
          nickname: entry.nickname,
          roundsPlayed: entry.roundsPlayed,
          roundsWon: entry.roundsWon,
          bankruptCount: entry.bankruptCount,
          totalPoints: entry.totalPoints,
          details,
        });
      }
      const snapshots = await this.persistence.listRoomSettlementSnapshots(room.roomCode, 1);
      room.message = "结算结果已保存，可在结算记录中查看。";
      room.latestSettlementSnapshot = (
        snapshots[0] ?? {
          snapshotId,
          roomCode: room.roomCode,
          createdByUserId: player.userId,
          createdAt: nowIso(),
          note,
          entries: [],
        }
      );
    } catch (error) {
      console.error("settleResult persistence failed:", error);
      const fallbackEntries =
        room.specialResult?.rankings.map((entry) => ({
          userId: entry.userId,
          nickname: entry.nickname,
          totalPoints: entry.totalPoints,
          roundsPlayed: 1,
          roundsWon: entry.rank === 1 ? 1 : 0,
          bankruptCount: entry.chips === 0 ? 1 : 0,
          details: [
            {
              roundId: room.specialResult?.roundId ?? createId("round"),
              settledAt: room.specialResult?.settledAt ?? nowIso(),
              points: entry.totalPoints,
              rank: entry.rank,
              chips: entry.chips,
            },
          ],
        })) ?? [];
      room.message = "结算结果已生成（数据库异常，本次仅临时展示，未写入持久化）。";
      room.latestSettlementSnapshot = {
        snapshotId,
        roomCode: room.roomCode,
        createdByUserId: player.userId,
        createdAt: nowIso(),
        note,
        entries: fallbackEntries,
      };
    }
    this.broadcastState(room, "room:state");
    return room.latestSettlementSnapshot;
  }

  private getAvailableActions(room: RoomRecord, player: PlayerRecord): AvailableAction[] {
    const hand = room.hand;
    if (!hand || !player.hand || hand.actionSeatIndex !== player.seatIndex) {
      return [];
    }
    const actions: AvailableAction[] = [{ type: "fold", label: "弃牌" }];
    const toCall = Math.max(0, hand.currentBet - player.hand.committedThisStreet);
    const maxTotal = player.hand.committedThisStreet + player.chips;
    if (toCall === 0) {
      actions.unshift({ type: "check", label: "过牌" });
    } else if (player.chips > 0) {
      actions.unshift({
        type: "call",
        amount: Math.min(toCall, player.chips),
        label: `跟注 ${Math.min(toCall, player.chips)}`,
      });
    }
    if (player.chips > 0) {
      actions.push({ type: "all_in", amount: maxTotal, label: `全下到 ${maxTotal}` });
    }
    if (player.chips > toCall && maxTotal > hand.currentBet) {
      const minRaiseTo = Math.min(maxTotal, hand.minRaiseTo ?? hand.currentBet + hand.lastFullRaise);
      if (maxTotal >= minRaiseTo) {
        actions.push({
          type: "raise",
          label: `加注（最小到 ${minRaiseTo}）`,
          minTotal: minRaiseTo,
          maxTotal,
        });
      }
    }
    return actions;
  }

  private computeSidePots(room: RoomRecord): PotState[] {
    const contributors = this.getParticipants(room)
      .filter((entry) => (entry.hand?.totalCommitted ?? 0) > 0)
      .sort((left, right) => (left.hand?.totalCommitted ?? 0) - (right.hand?.totalCommitted ?? 0));
    const levels = [...new Set(contributors.map((entry) => entry.hand?.totalCommitted ?? 0))];
    const pots: PotState[] = [];
    let previous = 0;
    for (const level of levels) {
      const involved = contributors.filter((entry) => (entry.hand?.totalCommitted ?? 0) >= level);
      const amount = (level - previous) * involved.length;
      if (amount > 0) {
        pots.push({
          amount,
          eligiblePlayerIds: involved.filter((entry) => !entry.hand?.folded).map((entry) => entry.id),
        });
      }
      previous = level;
    }
    return pots;
  }

  private refundUncalledBet(room: RoomRecord): void {
    const contributors = this.getParticipants(room)
      .filter((entry) => (entry.hand?.totalCommitted ?? 0) > 0)
      .sort((left, right) => (right.hand?.totalCommitted ?? 0) - (left.hand?.totalCommitted ?? 0));

    const largest = contributors[0];
    const secondLargest = contributors[1];
    if (!largest?.hand || !secondLargest?.hand) {
      return;
    }

    const refundAmount = largest.hand.totalCommitted - secondLargest.hand.totalCommitted;
    if (refundAmount <= 0) {
      return;
    }

    largest.hand.totalCommitted -= refundAmount;
    largest.hand.committedThisStreet = Math.max(0, largest.hand.committedThisStreet - refundAmount);
    largest.chips += refundAmount;
  }

  private buildRoomView(room: RoomRecord, viewerId: string): RoomView {
    const viewer = room.players.get(viewerId);
    if (!viewer) {
      throw new Error("玩家不存在");
    }
    return {
      roomCode: room.roomCode,
      status: room.status,
      config: room.config,
      hostPlayerId: room.hostPlayerId,
      viewerUserId: viewer.userId,
      viewerPlayerId: viewer.id,
      viewerReconnectToken: viewer.reconnectToken,
      viewerNickname: viewer.nickname,
      viewerSeatIndex: viewer.seatIndex,
      message: room.message,
      seats: Array.from({ length: room.config.maxPlayers }, (_, seatIndex) => this.buildSeatView(room, seatIndex, viewerId)),
      hand: this.buildHandSnapshot(room, viewerId),
      specialResult: room.specialResult,
      latestSettlementSnapshot: room.latestSettlementSnapshot,
      auditLogs: room.auditLogs,
      chatMessages: room.chatMessages,
    };
  }

  private buildSeatView(room: RoomRecord, seatIndex: number, viewerId: string): SeatView | null {
    const player = this.getPlayerBySeat(room, seatIndex);
    if (!player) {
      return null;
    }
    const showCards = player.id === viewerId || room.hand?.street === "showdown";
    return {
      seatIndex,
      playerId: player.id,
      nickname: player.nickname,
      stack: player.pendingStackOverride ?? player.chips,
      committedThisStreet: player.hand?.committedThisStreet ?? 0,
      totalCommitted: player.hand?.totalCommitted ?? 0,
      connected: player.connected,
      folded: player.hand?.folded ?? false,
      allIn: player.hand?.allIn ?? false,
      isDealer: room.hand?.dealerSeat === seatIndex,
      isSmallBlind: room.hand?.smallBlindSeat === seatIndex,
      isBigBlind: room.hand?.bigBlindSeat === seatIndex,
      isTurn: room.hand?.actionSeatIndex === seatIndex,
      isHost: player.isHost,
      isAdmin: player.isAdmin,
      visibleCards: showCards ? player.hand?.holeCards ?? [] : [],
    };
  }

  private buildHandSnapshot(room: RoomRecord, viewerId: string): HandSnapshot | null {
    const hand = room.hand;
    if (!hand) {
      return null;
    }
    const viewer = room.players.get(viewerId);
    return {
      handId: hand.id,
      street: hand.street,
      dealerSeat: hand.dealerSeat,
      smallBlindSeat: hand.smallBlindSeat,
      bigBlindSeat: hand.bigBlindSeat,
      actionSeatIndex: hand.actionSeatIndex,
      actionDeadlineAt: hand.actionDeadlineAt,
      currentBet: hand.currentBet,
      minRaiseTo: hand.minRaiseTo,
      communityCards: hand.communityCards,
      potTotal: this.getTotalPot(room),
      sidePots: hand.sidePots,
      winners: hand.winners,
      availableActions: viewer ? this.getAvailableActions(room, viewer) : [],
      lastAggressiveAction: hand.lastAggressiveAction,
    };
  }

  private broadcastState(room: RoomRecord, eventName: "room:state" | "game:state" | "game:result"): void {
    for (const player of room.players.values()) {
      if (!player.connected || !player.socketId) {
        continue;
      }
      this.io.to(player.socketId).emit(eventName, this.buildRoomView(room, player.id));
    }
  }

  private emitAnimation(room: RoomRecord, event: Pick<GameAnimationEvent, "kind" | "payload">): void {
    this.io.to(room.roomCode).emit("game:animation", {
      id: createId("anim"),
      roomCode: room.roomCode,
      kind: event.kind,
      createdAt: nowIso(),
      payload: event.payload,
    });
  }

  private pushAudit(room: RoomRecord, actorNickname: string, message: string): void {
    const log: AdminAuditLog = {
      id: createId("audit"),
      roomCode: room.roomCode,
      createdAt: nowIso(),
      actorNickname,
      message,
    };
    room.auditLogs = [...room.auditLogs.slice(-29), log];
    this.io.to(room.roomCode).emit("admin:audit", log);
  }

  private handleDisconnect(socketId: string): void {
    for (const room of this.rooms.values()) {
      const player = [...room.players.values()].find((entry) => entry.socketId === socketId);
      if (!player) {
        continue;
      }
      player.connected = false;
      player.socketId = null;
      room.message = `${player.nickname} 已断开连接，可使用原房间重连。`;
      this.broadcastState(room, room.hand ? "game:state" : "room:state");
      return;
    }
  }

  private scheduleTurnTimeout(room: RoomRecord, durationMs?: number): void {
    if (room.status !== "running" || !room.hand || room.hand.actionSeatIndex === null) {
      return;
    }
    this.clearTimer(room);
    const timeout = durationMs ?? room.config.actionSeconds * 1000;
    room.hand.actionDeadlineAt = new Date(Date.now() + timeout).toISOString();
    room.timer = setTimeout(() => {
      void this.handleTimeout(room.roomCode);
    }, timeout);
  }

  private clearTimer(room: RoomRecord): void {
    if (room.timer) {
      clearTimeout(room.timer);
      room.timer = null;
    }
  }

  private clearNextHandTimer(room: RoomRecord): void {
    if (room.nextHandTimer) {
      clearTimeout(room.nextHandTimer);
      room.nextHandTimer = null;
    }
  }

  private async handleTimeout(roomCode: string): Promise<void> {
    const room = this.rooms.get(roomCode);
    if (!room || room.status !== "running" || !room.hand || room.hand.actionSeatIndex === null) {
      return;
    }
    const player = this.getPlayerBySeat(room, room.hand.actionSeatIndex);
    if (!player) {
      return;
    }
    const available = this.getAvailableActions(room, player);
    const action = available.some((entry) => entry.type === "check") ? "check" : "fold";
    room.message = `${player.nickname} 超时，系统已自动${ACTION_LABEL[action]}。`;
    await this.applyAction(room, player, action, null);
    this.broadcastState(room, room.hand ? "game:state" : "game:result");
  }

  private createPlayer(
    authUser: AuthenticatedUser,
    nickname: string,
    chips: number,
    socketId: string,
    isHost: boolean,
  ): PlayerRecord {
    return {
      id: createId("player"),
      userId: authUser.userId,
      email: authUser.email,
      nickname,
      socketId,
      reconnectToken: randomUUID(),
      connected: true,
      isHost,
      isAdmin: isHost,
      seatIndex: null,
      chips,
      pendingStackOverride: null,
      pendingKick: false,
      hand: null,
    };
  }

  private async persistPlayer(room: RoomRecord, player: PlayerRecord): Promise<void> {
    await this.persistence.savePlayerState({
      roomCode: room.roomCode,
      playerId: player.id,
      userId: player.userId,
      nickname: player.nickname,
      seatIndex: player.seatIndex,
      stack: player.pendingStackOverride ?? player.chips,
      isHost: player.isHost,
    });
  }

  private commitChips(player: PlayerRecord, amount: number): number {
    if (!player.hand) {
      throw new Error("玩家不在本手牌中");
    }
    const actual = clamp(amount, 0, player.chips);
    player.chips -= actual;
    player.hand.committedThisStreet += actual;
    player.hand.totalCommitted += actual;
    if (player.chips === 0) {
      player.hand.allIn = true;
    }
    return actual;
  }

  private resetOthersToRespond(room: RoomRecord, actorPlayerId: string): void {
    for (const participant of this.getParticipants(room)) {
      if (!participant.hand || participant.id === actorPlayerId || participant.hand.folded || participant.hand.allIn) {
        continue;
      }
      participant.hand.actedThisStreet = false;
    }
  }

  private postForcedBet(room: RoomRecord, seatIndex: number, amount: number): void {
    const player = this.getPlayerBySeat(room, seatIndex);
    if (player?.hand) {
      this.commitChips(player, amount);
    }
  }

  private getTotalPot(room: RoomRecord): number {
    return this.getParticipants(room).reduce((sum, entry) => sum + (entry.hand?.totalCommitted ?? 0), 0);
  }

  private removeKickedPlayers(room: RoomRecord): void {
    for (const player of [...room.players.values()]) {
      if (player.pendingKick) {
        room.players.delete(player.id);
      }
    }
  }

  private relativeSeatDistance(origin: number, target: number, totalSeats: number): number {
    return (target - origin + totalSeats) % totalSeats;
  }

  private isActiveParticipant(player: PlayerRecord): boolean {
    return Boolean(player.hand);
  }

  private getParticipants(room: RoomRecord): PlayerRecord[] {
    return this.getSeatedPlayers(room).filter((entry) => entry.hand !== null);
  }

  private getSeatedPlayers(room: RoomRecord): PlayerRecord[] {
    return [...room.players.values()]
      .filter((entry) => entry.seatIndex !== null)
      .sort((left, right) => (left.seatIndex ?? 0) - (right.seatIndex ?? 0));
  }

  private getPlayerBySeat(room: RoomRecord, seatIndex: number): PlayerRecord | undefined {
    return [...room.players.values()].find((entry) => entry.seatIndex === seatIndex);
  }

  private getAuthUser(socket: AppSocket): AuthenticatedUser {
    const authUser = socket.data.authUser;
    if (!authUser?.userId) {
      throw new Error("未登录或登录信息无效");
    }
    return authUser;
  }

  private findNextOccupiedSeat(
    room: RoomRecord,
    fromSeat: number,
    predicate: (player: PlayerRecord) => boolean,
  ): number | null {
    for (let offset = 1; offset <= room.config.maxPlayers; offset += 1) {
      const seatIndex = (fromSeat + offset + room.config.maxPlayers) % room.config.maxPlayers;
      const player = this.getPlayerBySeat(room, seatIndex);
      if (player && predicate(player)) {
        return seatIndex;
      }
    }
    return null;
  }

  private getRoom(roomCode: string): RoomRecord {
    const room = this.rooms.get(roomCode.trim().toUpperCase());
    if (!room) {
      throw new Error("房间不存在");
    }
    return room;
  }

  private getRoomAndPlayer(socketId: string, roomCode: string): { room: RoomRecord; player: PlayerRecord } {
    const room = this.getRoom(roomCode);
    const player = [...room.players.values()].find((entry) => entry.socketId === socketId);
    if (!player) {
      throw new Error("玩家未在该房间中");
    }
    return { room, player };
  }

  private assertAdmin(player: PlayerRecord): void {
    if (!player.isAdmin) {
      throw new Error("只有管理员可以执行该操作");
    }
  }

  private assertHost(room: RoomRecord, player: PlayerRecord): void {
    if (room.hostPlayerId !== player.id) {
      throw new Error("只有房主可以执行该操作");
    }
  }

  private validateNickname(value: string): string {
    const nickname = value.trim().slice(0, 12);
    if (!nickname) {
      throw new Error("昵称不能为空");
    }
    return nickname;
  }

  private validateRoomConfig(config: RoomConfig): RoomConfig {
    const normalized: RoomConfig = {
      maxPlayers: clamp(Math.floor(config.maxPlayers), 4, 7),
      startingChips: clamp(Math.floor(config.startingChips), 100, 1000000),
      smallBlind: clamp(Math.floor(config.smallBlind), 1, 100000),
      bigBlind: clamp(Math.floor(config.bigBlind), 2, 200000),
      actionSeconds: clamp(Math.floor(config.actionSeconds), 5, 90),
      allowMidHandJoin: Boolean(config.allowMidHandJoin),
      gameMode: "ranked",
    };
    if (normalized.bigBlind <= normalized.smallBlind) {
      normalized.bigBlind = normalized.smallBlind * 2;
    }
    return normalized;
  }
}
