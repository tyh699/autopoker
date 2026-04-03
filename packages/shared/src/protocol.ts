export type Suit = "clubs" | "diamonds" | "hearts" | "spades";
export type Rank =
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "T"
  | "J"
  | "Q"
  | "K"
  | "A";

export interface Card {
  rank: Rank;
  suit: Suit;
}

export type RoomStatus = "waiting" | "running" | "paused" | "ended";
export type GameStreet = "preflop" | "flop" | "turn" | "river" | "showdown";
export type PlayerActionType = "check" | "call" | "raise" | "fold" | "all_in";
export type GameMode = "classic" | "red_packet_bust";

export interface RoomConfig {
  maxPlayers: number;
  startingChips: number;
  smallBlind: number;
  bigBlind: number;
  actionSeconds: number;
  allowMidHandJoin: boolean;
  gameMode: GameMode;
}

export interface ReconnectToken {
  roomCode: string;
  playerId: string;
  token: string;
}

export interface AvailableAction {
  type: PlayerActionType;
  amount?: number;
  minTotal?: number;
  maxTotal?: number;
  label: string;
}

export interface PotState {
  amount: number;
  eligiblePlayerIds: string[];
}

export interface ChipRankingEntry {
  playerId: string;
  nickname: string;
  chips: number;
  rank: number;
  reverseRank: number;
  shouldSendRedPacket: boolean;
}

export interface SpecialGameResult {
  mode: GameMode;
  reason: string;
  redPacketPlayerId: string | null;
  redPacketNickname: string | null;
  rankings: ChipRankingEntry[];
}

export interface WinnerSummary {
  playerId: string;
  nickname: string;
  amount: number;
  handName: string;
  handDescription: string;
  bestFiveCards: Card[];
}

export interface SeatView {
  seatIndex: number;
  playerId: string;
  nickname: string;
  stack: number;
  committedThisStreet: number;
  totalCommitted: number;
  connected: boolean;
  folded: boolean;
  allIn: boolean;
  isDealer: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  isTurn: boolean;
  isHost: boolean;
  isAdmin: boolean;
  visibleCards: Card[];
}

export interface HandSnapshot {
  handId: string;
  street: GameStreet;
  dealerSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  actionSeatIndex: number | null;
  actionDeadlineAt: string | null;
  currentBet: number;
  minRaiseTo: number | null;
  communityCards: Card[];
  potTotal: number;
  sidePots: PotState[];
  winners: WinnerSummary[];
  availableActions: AvailableAction[];
  lastAggressiveAction: string;
}

export interface AdminAuditLog {
  id: string;
  roomCode: string;
  createdAt: string;
  actorNickname: string;
  message: string;
}

export interface ChatMessage {
  id: string;
  roomCode: string;
  playerId: string;
  userId?: string;
  nickname: string;
  text: string;
  createdAt: string;
}

export interface RoomView {
  roomCode: string;
  status: RoomStatus;
  config: RoomConfig;
  hostPlayerId: string;
  viewerUserId: string;
  viewerPlayerId: string;
  viewerReconnectToken: string;
  viewerNickname: string;
  viewerSeatIndex: number | null;
  message: string;
  seats: Array<SeatView | null>;
  hand: HandSnapshot | null;
  specialResult: SpecialGameResult | null;
  auditLogs: AdminAuditLog[];
  chatMessages: ChatMessage[];
}

export interface CreateRoomPayload {
  nickname: string;
  config: RoomConfig;
}

export interface JoinRoomPayload {
  roomCode: string;
  nickname: string;
}

export interface ReconnectRoomPayload {
  roomCode: string;
  reconnectToken: string;
}

export interface SeatTakePayload {
  roomCode: string;
  seatIndex: number;
}

export interface GameStartPayload {
  roomCode: string;
}

export interface GameActionPayload {
  roomCode: string;
  action: {
    type: PlayerActionType;
    amount?: number;
  };
}

export interface AdminSetChipsPayload {
  roomCode: string;
  targetPlayerId: string;
  chips: number;
}

export interface AdminRoomPayload {
  roomCode: string;
}

export interface AdminKickPayload {
  roomCode: string;
  targetPlayerId: string;
}

export interface ChatSendPayload {
  roomCode: string;
  text: string;
}

export interface GameAnimationEvent {
  id: string;
  roomCode: string;
  kind:
    | "deal_hole"
    | "reveal_flop"
    | "reveal_turn"
    | "reveal_river"
    | "chips_to_pot"
    | "award_pot"
    | "showdown";
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface UserHandHistoryItem {
  handId: string;
  roomCode: string;
  nickname: string;
  startedAt: string;
  finishedAt: string | null;
  wonAmount: number;
  deltaChips: number;
  isWinner: boolean;
  winningHandName: string | null;
}

export interface RoomHandHistoryItem {
  handId: string;
  roomCode: string;
  street: GameStreet;
  startedAt: string;
  finishedAt: string | null;
  winners: WinnerSummary[];
}

export interface LeaderboardItem {
  userId: string;
  nickname: string;
  handsPlayed: number;
  handsWon: number;
  netChips: number;
}

export type SocketAck<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: string;
    };

export interface ClientToServerEvents {
  "room:create": (
    payload: CreateRoomPayload,
    callback: (ack: SocketAck<RoomView>) => void,
  ) => void;
  "room:join": (
    payload: JoinRoomPayload,
    callback: (ack: SocketAck<RoomView>) => void,
  ) => void;
  "room:reconnect": (
    payload: ReconnectRoomPayload,
    callback: (ack: SocketAck<RoomView>) => void,
  ) => void;
  "seat:take": (
    payload: SeatTakePayload,
    callback: (ack: SocketAck<RoomView>) => void,
  ) => void;
  "game:start": (
    payload: GameStartPayload,
    callback: (ack: SocketAck<RoomView>) => void,
  ) => void;
  "game:action": (
    payload: GameActionPayload,
    callback: (ack: SocketAck<RoomView>) => void,
  ) => void;
  "admin:set_chips": (
    payload: AdminSetChipsPayload,
    callback: (ack: SocketAck<RoomView>) => void,
  ) => void;
  "admin:pause": (
    payload: AdminRoomPayload,
    callback: (ack: SocketAck<RoomView>) => void,
  ) => void;
  "admin:resume": (
    payload: AdminRoomPayload,
    callback: (ack: SocketAck<RoomView>) => void,
  ) => void;
  "admin:end_hand": (
    payload: AdminRoomPayload,
    callback: (ack: SocketAck<RoomView>) => void,
  ) => void;
  "admin:kick": (
    payload: AdminKickPayload,
    callback: (ack: SocketAck<RoomView>) => void,
  ) => void;
  "chat:send": (
    payload: ChatSendPayload,
    callback: (ack: SocketAck<RoomView>) => void,
  ) => void;
}

export interface ServerToClientEvents {
  "room:state": (state: RoomView) => void;
  "game:state": (state: RoomView) => void;
  "game:animation": (event: GameAnimationEvent) => void;
  "game:result": (state: RoomView) => void;
  "admin:audit": (log: AdminAuditLog) => void;
  "chat:message": (message: ChatMessage) => void;
  "system:error": (message: string) => void;
}
