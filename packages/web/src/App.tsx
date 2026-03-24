import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  AdminAuditLog,
  Card,
  ChatMessage,
  ClientToServerEvents,
  GameActionPayload,
  GameAnimationEvent,
  GameMode,
  RoomConfig,
  RoomView,
  SeatView,
  ServerToClientEvents,
  SpecialGameResult,
  SocketAck,
  WinnerSummary,
} from "@poker/shared";
import { DISPLAY_RANK, GAME_MODE_LABEL, STREET_LABEL, SUIT_SYMBOL, formatCard } from "@poker/shared";

function resolveServerUrl(): string {
  if (import.meta.env.VITE_SERVER_URL) {
    return import.meta.env.VITE_SERVER_URL;
  }
  if (typeof window === "undefined") {
    return "http://localhost:3001";
  }
  const { protocol, hostname, port, origin } = window.location;
  if (port === "5173") {
    return `${protocol}//${hostname}:3001`;
  }
  return origin;
}

const SERVER_URL = resolveServerUrl();
const RECENT_KEY = "poker:last-session";
const SETTLEMENT_OVERLAY_MS = 2000;

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface SessionSnapshot {
  roomCode: string;
  reconnectToken: string;
}

interface SettlementState {
  handId: string;
  title: string;
  winners: WinnerSummary[];
  specialResult: SpecialGameResult | null;
}

const defaultConfig: RoomConfig = {
  maxPlayers: 6,
  startingChips: 2000,
  smallBlind: 10,
  bigBlind: 20,
  actionSeconds: 20,
  allowMidHandJoin: true,
  gameMode: "classic",
};

const CHAT_TRACKS = [16, 28, 40, 52];
const SEAT_LAYOUTS: Record<number, Array<{ left: number; top: number }>> = {
  2: [
    { left: 50, top: 6 },
    { left: 50, top: 94 },
  ],
  3: [
    { left: 50, top: 6 },
    { left: 87, top: 66 },
    { left: 13, top: 66 },
  ],
  4: [
    { left: 50, top: 5 },
    { left: 92, top: 34 },
    { left: 50, top: 94 },
    { left: 8, top: 34 },
  ],
  5: [
    { left: 50, top: 5 },
    { left: 85, top: 22 },
    { left: 82, top: 78 },
    { left: 18, top: 78 },
    { left: 15, top: 22 },
  ],
  6: [
    { left: 50, top: 4 },
    { left: 80, top: 16 },
    { left: 92, top: 50 },
    { left: 70, top: 90 },
    { left: 30, top: 90 },
    { left: 8, top: 50 },
  ],
  7: [
    { left: 50, top: 4 },
    { left: 76, top: 12 },
    { left: 92, top: 36 },
    { left: 84, top: 78 },
    { left: 50, top: 93 },
    { left: 16, top: 78 },
    { left: 8, top: 36 },
  ],
  8: [
    { left: 50, top: 4 },
    { left: 72, top: 10 },
    { left: 90, top: 28 },
    { left: 94, top: 58 },
    { left: 72, top: 90 },
    { left: 28, top: 90 },
    { left: 6, top: 58 },
    { left: 10, top: 28 },
  ],
  9: [
    { left: 50, top: 4 },
    { left: 68, top: 8 },
    { left: 86, top: 22 },
    { left: 96, top: 48 },
    { left: 78, top: 84 },
    { left: 50, top: 94 },
    { left: 22, top: 84 },
    { left: 4, top: 48 },
    { left: 14, top: 22 },
  ],
  10: [
    { left: 50, top: 4 },
    { left: 68, top: 8 },
    { left: 86, top: 20 },
    { left: 96, top: 42 },
    { left: 88, top: 74 },
    { left: 66, top: 92 },
    { left: 34, top: 92 },
    { left: 12, top: 74 },
    { left: 4, top: 42 },
    { left: 14, top: 20 },
  ],
};

function socketAck<T>(ack: SocketAck<T>): T {
  if (!ack.ok) {
    throw new Error(ack.error);
  }
  return ack.data;
}

function formatTime(deadline?: string | null): number {
  if (!deadline) {
    return 0;
  }
  return Math.max(0, Math.ceil((new Date(deadline).getTime() - Date.now()) / 1000));
}

function getSeatPosition(index: number, total: number): { left: string; top: string } {
  const preset = SEAT_LAYOUTS[total]?.[index];
  if (preset) {
    return {
      left: `${preset.left}%`,
      top: `${preset.top}%`,
    };
  }
  const angle = (-Math.PI / 2) + ((Math.PI * 2) / total) * index;
  const x = 50 + Math.cos(angle) * 46;
  const y = 50 + Math.sin(angle) * 42;
  return {
    left: `${x}%`,
    top: `${y}%`,
  };
}

function formatPot(pot: number): string {
  return `底池 ${pot}`;
}

function formatCards(cards: Card[]): string {
  return cards.map((card) => formatCard(card)).join(" ");
}

function formatWinnerTitle(winners: WinnerSummary[]): string {
  if (!winners.length) {
    return "本手结束";
  }
  if (winners.length === 1) {
    return `${winners[0].nickname} 获胜`;
  }
  return "多人瓜分底池";
}

function formatRoomStatus(status: RoomView["status"]): string {
  if (status === "running") {
    return "进行中";
  }
  if (status === "paused") {
    return "已暂停";
  }
  if (status === "ended") {
    return "已结束";
  }
  return "等待中";
}

function findRecommendedSeat(room: RoomView): number | null {
  const preferred = Math.floor(room.config.maxPlayers / 2);
  if (!room.seats[preferred]) {
    return preferred;
  }
  for (let index = 0; index < room.seats.length; index += 1) {
    if (!room.seats[index]) {
      return index;
    }
  }
  return null;
}

function CardFace({ card, hidden = false, large = false }: { card?: Card; hidden?: boolean; large?: boolean }) {
  if (hidden || !card) {
    return <div className={`card-face card-hidden ${large ? "is-large" : ""}`}>德扑</div>;
  }
  const red = card.suit === "hearts" || card.suit === "diamonds";
  return (
    <div className={`card-face ${red ? "is-red" : ""} ${large ? "is-large" : ""}`}>
      <span>{DISPLAY_RANK[card.rank]}</span>
      <span>{SUIT_SYMBOL[card.suit]}</span>
    </div>
  );
}

function LandingPage(props: {
  notice: string;
  error: string;
  recentSession: SessionSnapshot | null;
  createName: string;
  setCreateName: (value: string) => void;
  joinCode: string;
  setJoinCode: (value: string) => void;
  joinName: string;
  setJoinName: (value: string) => void;
  config: RoomConfig;
  setConfig: React.Dispatch<React.SetStateAction<RoomConfig>>;
  onReconnect: () => void;
  onCreate: () => void;
  onJoin: () => void;
}) {
  const {
    notice,
    error,
    recentSession,
    createName,
    setCreateName,
    joinCode,
    setJoinCode,
    joinName,
    setJoinName,
    config,
    setConfig,
    onReconnect,
    onCreate,
    onJoin,
  } = props;

  return (
    <div className="landing-shell">
      <div className="landing-backdrop" />
      <main className="landing-grid">
        <section className="hero-panel">
          <p className="eyebrow">中文联机德州扑克</p>
          <h1>像真正牌桌一样铺满整个屏幕，而不是像后台页面。</h1>
          <p className="hero-copy">
            支持 2 到 10 人中文联机、私人房间、管理员筹码调整、断线重连和更明显的结算提示。
          </p>
          <div className="status-bar">
            <span>{notice}</span>
            {error ? <strong>{error}</strong> : null}
          </div>
          {recentSession ? (
            <button className="accent-button" onClick={onReconnect}>
              恢复最近房间 {recentSession.roomCode}
            </button>
          ) : null}
        </section>

        <section className="card-panel">
          <h2>创建房间</h2>
          <label>
            房主昵称
            <input value={createName} onChange={(event) => setCreateName(event.target.value)} />
          </label>
          <div className="grid-fields">
            <label>
              座位数
              <input
                type="number"
                min={2}
                max={10}
                value={config.maxPlayers}
                onChange={(event) => setConfig((current) => ({ ...current, maxPlayers: Number(event.target.value) }))}
              />
            </label>
            <label>
              初始筹码
              <input
                type="number"
                value={config.startingChips}
                onChange={(event) =>
                  setConfig((current) => ({ ...current, startingChips: Number(event.target.value) }))
                }
              />
            </label>
            <label>
              小盲
              <input
                type="number"
                value={config.smallBlind}
                onChange={(event) => setConfig((current) => ({ ...current, smallBlind: Number(event.target.value) }))}
              />
            </label>
            <label>
              大盲
              <input
                type="number"
                value={config.bigBlind}
                onChange={(event) => setConfig((current) => ({ ...current, bigBlind: Number(event.target.value) }))}
              />
            </label>
            <label>
              行动秒数
              <input
                type="number"
                value={config.actionSeconds}
                onChange={(event) =>
                  setConfig((current) => ({ ...current, actionSeconds: Number(event.target.value) }))
                }
              />
            </label>
            <label>
              玩法模式
              <select
                value={config.gameMode}
                onChange={(event) =>
                  setConfig((current) => ({ ...current, gameMode: event.target.value as GameMode }))
                }
              >
                <option value="classic">{GAME_MODE_LABEL.classic}</option>
                <option value="red_packet_bust">{GAME_MODE_LABEL.red_packet_bust}</option>
              </select>
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={config.allowMidHandJoin}
                onChange={(event) =>
                  setConfig((current) => ({ ...current, allowMidHandJoin: event.target.checked }))
                }
              />
              允许牌局进行中入座
            </label>
          </div>
          <button className="accent-button" onClick={onCreate}>
            创建私人房间
          </button>
        </section>

        <section className="card-panel">
          <h2>加入房间</h2>
          <label>
            房间号
            <input value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} />
          </label>
          <label>
            玩家昵称
            <input value={joinName} onChange={(event) => setJoinName(event.target.value)} />
          </label>
          <button className="ghost-button" onClick={onJoin}>
            加入房间
          </button>
        </section>
      </main>
    </div>
  );
}

export function App() {
  const socketRef = useRef<AppSocket | null>(null);
  const settlementTimerRef = useRef<number | null>(null);

  const [room, setRoom] = useState<RoomView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("连接中...");
  const [lastAnimation, setLastAnimation] = useState<GameAnimationEvent["kind"] | null>(null);
  const [recentSession, setRecentSession] = useState<SessionSnapshot | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [createName, setCreateName] = useState("房主");
  const [joinCode, setJoinCode] = useState("");
  const [joinName, setJoinName] = useState("玩家");
  const [config, setConfig] = useState<RoomConfig>(defaultConfig);
  const [chatText, setChatText] = useState("");
  const [raiseTotal, setRaiseTotal] = useState(0);
  const [adminTarget, setAdminTarget] = useState("");
  const [adminChips, setAdminChips] = useState("2000");
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [showChatOverlay, setShowChatOverlay] = useState(true);
  const [showChatComposer, setShowChatComposer] = useState(false);
  const [settlement, setSettlement] = useState<SettlementState | null>(null);
  const [roleNotice, setRoleNotice] = useState("");
  const [resetNotice, setResetNotice] = useState("");

  useEffect(() => {
    const socket = io(SERVER_URL, { autoConnect: true });
    socketRef.current = socket;

    const syncRoom = (nextRoom: RoomView) => {
      setRoom(nextRoom);
      setNotice(nextRoom.message);
      const snapshot = {
        roomCode: nextRoom.roomCode,
        reconnectToken: nextRoom.viewerReconnectToken,
      };
      setRecentSession(snapshot);
      localStorage.setItem(RECENT_KEY, JSON.stringify(snapshot));
    };

    socket.on("connect", () => {
      setNotice("连接成功，可以创建或加入房间。");
    });
    socket.on("room:state", syncRoom);
    socket.on("game:state", syncRoom);
    socket.on("game:result", (nextRoom) => {
      syncRoom(nextRoom);
      if (nextRoom.hand?.winners.length || nextRoom.specialResult) {
        setSettlement({
          handId: nextRoom.hand?.handId ?? `result-${Date.now()}`,
          title: nextRoom.specialResult
            ? GAME_MODE_LABEL[nextRoom.specialResult.mode as keyof typeof GAME_MODE_LABEL]
            : formatWinnerTitle(nextRoom.hand?.winners ?? []),
          winners: nextRoom.hand?.winners ?? [],
          specialResult: nextRoom.specialResult,
        });
        if (settlementTimerRef.current) {
          window.clearTimeout(settlementTimerRef.current);
        }
        settlementTimerRef.current = window.setTimeout(() => setSettlement(null), SETTLEMENT_OVERLAY_MS);
      }
    });
    socket.on("system:error", (message) => setError(message));
    socket.on("game:animation", (event) => {
      setLastAnimation(event.kind);
      window.setTimeout(() => setLastAnimation(null), 1500);
      if (event.kind === "showdown") {
        setNotice("进入摊牌阶段，正在比较大小...");
      }
    });

    const recent = localStorage.getItem(RECENT_KEY);
    if (recent) {
      try {
        setRecentSession(JSON.parse(recent) as SessionSnapshot);
      } catch {
        localStorage.removeItem(RECENT_KEY);
      }
    }

    return () => {
      if (settlementTimerRef.current) {
        window.clearTimeout(settlementTimerRef.current);
      }
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCountdown(formatTime(room?.hand?.actionDeadlineAt));
    }, 250);
    return () => window.clearInterval(timer);
  }, [room?.hand?.actionDeadlineAt]);

  const emitAck = async <T,>(event: keyof ClientToServerEvents, payload: unknown): Promise<T> => {
    const socket = socketRef.current;
    if (!socket) {
      throw new Error("Socket 未连接");
    }
    return new Promise<T>((resolve, reject) => {
      (
        socket as unknown as {
          emit: (name: string, body: unknown, callback: (ack: SocketAck<T>) => void) => void;
        }
      ).emit(event, payload, (ack: SocketAck<T>) => {
        try {
          resolve(socketAck(ack));
          setError("");
        } catch (nextError) {
          reject(nextError);
        }
      });
    });
  };

  const handle = async (work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "请求失败");
    }
  };

  const viewerSeat = room?.seats.find((seat) => seat?.playerId === room.viewerPlayerId) ?? null;
  const isAdmin = room ? room.hostPlayerId === room.viewerPlayerId || Boolean(viewerSeat?.isAdmin) : false;
  const seatedPlayers = (room?.seats.filter((seat): seat is SeatView => Boolean(seat)) ?? []);
  const availableActions = room?.hand?.availableActions ?? [];
  const raiseAction = availableActions.find((action) => action.type === "raise");
  const selectedPlayer = seatedPlayers.find((seat) => seat.playerId === adminTarget);
  const winnerIds = new Set(settlement?.winners.map((winner) => winner.playerId) ?? []);
  const quickSeatIndex = room && room.viewerSeatIndex === null ? findRecommendedSeat(room) : null;
  const viewerCardsHidden = !viewerSeat || viewerSeat.visibleCards.length === 0;

  useEffect(() => {
    if (raiseAction?.minTotal) {
      setRaiseTotal(raiseAction.minTotal);
    }
  }, [raiseAction?.minTotal]);

  useEffect(() => {
    if (!adminTarget && seatedPlayers[0]) {
      setAdminTarget(seatedPlayers[0].playerId);
      setAdminChips(String(seatedPlayers[0].stack));
    }
  }, [adminTarget, seatedPlayers]);

  useEffect(() => {
    if (!room?.hand?.handId || !viewerSeat) {
      return;
    }
    const tags = [viewerSeat.isSmallBlind ? "你是小盲" : "", viewerSeat.isBigBlind ? "你是大盲" : ""].filter(Boolean);
    if (!tags.length) {
      return;
    }
    setRoleNotice(tags.join("，"));
    const timer = window.setTimeout(() => setRoleNotice(""), 2200);
    return () => window.clearTimeout(timer);
  }, [room?.hand?.handId, viewerSeat?.isSmallBlind, viewerSeat?.isBigBlind]);

  useEffect(() => {
    if (room?.specialResult?.mode !== "red_packet_bust") {
      return;
    }
    setResetNotice("所有人筹码已恢复为初始值");
    const timer = window.setTimeout(() => setResetNotice(""), 1000);
    return () => window.clearTimeout(timer);
  }, [room?.specialResult]);

  if (!room) {
    return (
      <LandingPage
        notice={notice}
        error={error}
        recentSession={recentSession}
        createName={createName}
        setCreateName={setCreateName}
        joinCode={joinCode}
        setJoinCode={setJoinCode}
        joinName={joinName}
        setJoinName={setJoinName}
        config={config}
        setConfig={setConfig}
        onReconnect={() =>
          handle(async () => {
            if (!recentSession) return;
            const nextRoom = await emitAck<RoomView>("room:reconnect", recentSession);
            setRoom(nextRoom);
          })
        }
        onCreate={() =>
          handle(async () => {
            const nextRoom = await emitAck<RoomView>("room:create", { nickname: createName, config });
            setRoom(nextRoom);
          })
        }
        onJoin={() =>
          handle(async () => {
            const nextRoom = await emitAck<RoomView>("room:join", { roomCode: joinCode, nickname: joinName });
            setRoom(nextRoom);
          })
        }
      />
    );
  }

  const sendAction = (type: GameActionPayload["action"]["type"], amount?: number) =>
    handle(async () => {
      await emitAck("game:action", { roomCode: room.roomCode, action: { type, amount } });
    });

  const sendChat = () =>
    handle(async () => {
      if (!chatText.trim()) return;
      await emitAck("chat:send", { roomCode: room.roomCode, text: chatText });
      setChatText("");
      setShowChatOverlay(true);
    });

  return (
    <div className={`table-shell table-shell--full ${lastAnimation ? `anim-${lastAnimation}` : ""}`}>
      <div className="table-ambient-glow" />

      <header className="table-topbar">
        <div className="brand-block">
          <div className="brand-mark">中文德扑</div>
          <div className="brand-copy">
            <strong>房间 {room.roomCode}</strong>
            <span>{notice}</span>
          </div>
        </div>

        <div className="table-statusbar">
          <div className="status-pill">{GAME_MODE_LABEL[room.config.gameMode]}</div>
          <div className="status-pill">盲注 {room.config.smallBlind} / {room.config.bigBlind}</div>
          <div className="status-pill">{room.hand ? STREET_LABEL[room.hand.street] : "等待开局"}</div>
          <div className="status-pill">{formatRoomStatus(room.status)}</div>
        </div>
      </header>

      <aside className="left-rail">
        <button className="rail-button" onClick={() => setShowChatOverlay((current) => !current)}>
          <span>聊天</span>
          <strong>{showChatOverlay ? "隐藏" : "显示"}</strong>
        </button>
        <button className="rail-button" onClick={() => setShowChatComposer((current) => !current)}>
          <span>发消息</span>
          <strong>{showChatComposer ? "收起" : "展开"}</strong>
        </button>
        {isAdmin ? (
          <button className="rail-button rail-button--admin" onClick={() => setShowAdminPanel((current) => !current)}>
            <span>控场</span>
            <strong>{showAdminPanel ? "关闭" : "打开"}</strong>
          </button>
        ) : null}
      </aside>

      {error ? <div className="error-banner error-banner--floating">{error}</div> : null}
      {roleNotice ? <div className="hero-banner">{roleNotice}</div> : null}
      {resetNotice ? <div className="reset-banner">{resetNotice}</div> : null}

      <main className="table-main">
        <section className="table-stage table-stage--immersive">
          <div className="table-felt table-felt--elliptical">
            <div className="table-pot-hud">
              <span>{room.hand ? formatPot(room.hand.potTotal) : "等待开局"}</span>
              <strong>{countdown > 0 ? `${countdown}s` : " "}</strong>
            </div>

            <div className="table-watermark">
              <span>无限注德州扑克</span>
              <small>中文多人联机牌桌</small>
            </div>

            {!room.hand ? (
              <div className="room-waiting-panel">
                <p className="eyebrow">房间准备阶段</p>
                <h2>{room.viewerSeatIndex === null ? "先坐下，再开始牌局" : "等待更多玩家或直接开始"}</h2>
                <p>
                  房间号 <strong>{room.roomCode}</strong>
                  {room.viewerSeatIndex !== null ? `，你当前在 ${room.viewerSeatIndex + 1} 号位。` : "，你当前还没有入座。"}
                </p>
                <div className="room-waiting-actions">
                  {quickSeatIndex !== null ? (
                    <button
                      className="accent-button"
                      onClick={() =>
                        handle(async () => {
                          await emitAck<RoomView>("seat:take", { roomCode: room.roomCode, seatIndex: quickSeatIndex });
                        })
                      }
                    >
                      坐到推荐座位
                    </button>
                  ) : null}
                  {isAdmin ? (
                    <button
                      className="ghost-button"
                      onClick={() => handle(() => emitAck("game:start", { roomCode: room.roomCode }))}
                    >
                      直接开始手牌
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="board-center board-center--immersive">
              <div className="community-row community-row--immersive">
                {Array.from({ length: 5 }, (_, index) => (
                  <CardFace
                    key={index}
                    card={room.hand?.communityCards[index]}
                    hidden={!room.hand?.communityCards[index]}
                    large
                  />
                ))}
              </div>
              <div className="board-subtext">
                {room.hand?.lastAggressiveAction ?? "等待房主开始下一手"}
              </div>
            </div>

            {room.seats.map((seat, index) => {
              if (seat?.playerId === room.viewerPlayerId) {
                return null;
              }
              const position = getSeatPosition(index, room.seats.length);
              return (
                <div key={index} className="seat-anchor" style={position}>
                  {seat ? (
                    <PlayerSeatCard seat={seat} isWinner={winnerIds.has(seat.playerId)} isViewer={seat.playerId === room.viewerPlayerId} />
                  ) : (
                    <button
                      className="seat-empty seat-empty--floating"
                      onClick={() =>
                        handle(async () => {
                          await emitAck<RoomView>("seat:take", { roomCode: room.roomCode, seatIndex: index });
                        })
                      }
                    >
                      入座
                    </button>
                  )}
                </div>
              );
            })}

            {showChatOverlay ? <ChatBarrage messages={room.chatMessages} /> : null}
          </div>
        </section>

        <section className="action-dock">
          <div className="viewer-summary">
            <div className="viewer-summary__header">
              <div>
                <p className="eyebrow">我的位置</p>
                <h2>{room.viewerNickname}</h2>
              </div>
              <span className={`viewer-status ${viewerSeat?.connected === false ? "is-offline" : ""}`}>
                {viewerSeat ? (viewerSeat.connected ? "在线" : "离线") : "观战中"}
              </span>
            </div>

            {viewerSeat ? (
              <>
                <div className="seat-badges seat-badges--viewer">
                  {viewerSeat.isDealer ? <span>D</span> : null}
                  {viewerSeat.isSmallBlind ? <span>SB</span> : null}
                  {viewerSeat.isBigBlind ? <span>BB</span> : null}
                  {viewerSeat.allIn ? <span>全下</span> : null}
                  {viewerSeat.folded ? <span>已弃牌</span> : null}
                </div>
                <div className="seat-cards seat-cards--viewer">
                  <CardFace card={viewerSeat.visibleCards[0]} hidden={viewerCardsHidden} />
                  <CardFace card={viewerSeat.visibleCards[1]} hidden={viewerCardsHidden} />
                </div>
                <div className="viewer-meta">
                  <span>筹码 {viewerSeat.stack}</span>
                  <span>座位 {viewerSeat.seatIndex + 1}</span>
                  <span>已投 {viewerSeat.totalCommitted}</span>
                </div>
              </>
            ) : (
              <div className="viewer-meta">
                <span>尚未入座</span>
                <span>可先选择一个空位</span>
              </div>
            )}
          </div>

          <div className="action-cluster">
            {availableActions.length ? (
              <>
                {availableActions
                  .filter((action) => action.type !== "raise")
                  .map((action) => (
                    <button
                      key={action.type}
                      className={`action-button action-button--${action.type}`}
                      onClick={() => sendAction(action.type)}
                    >
                      {action.label}
                    </button>
                  ))}

                {raiseAction ? (
                  <div className="raise-panel">
                    <div className="raise-header">
                      <span>加注到</span>
                      <strong>{raiseTotal}</strong>
                    </div>
                    <input
                      type="range"
                      min={raiseAction.minTotal}
                      max={raiseAction.maxTotal}
                      value={raiseTotal}
                      onChange={(event) => setRaiseTotal(Number(event.target.value))}
                    />
                    <div className="raise-range">
                      <span>最小 {raiseAction.minTotal}</span>
                      <span>最大 {raiseAction.maxTotal}</span>
                    </div>
                    <button className="action-button action-button--raise" onClick={() => sendAction("raise", raiseTotal)}>
                      确认加注
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="waiting-panel">
                <strong>{room.hand ? "等待轮到你行动" : "等待开始手牌"}</strong>
                <span>{room.message}</span>
              </div>
            )}
          </div>
        </section>
      </main>

      <div className={`chat-composer ${showChatComposer ? "is-open" : ""}`}>
        <input
          value={chatText}
          onChange={(event) => setChatText(event.target.value)}
          placeholder="发送房间弹幕..."
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void sendChat();
            }
          }}
        />
        <button className="accent-button" onClick={() => void sendChat()}>
          发送
        </button>
      </div>

      {isAdmin ? (
        <div className={`admin-drawer ${showAdminPanel ? "is-open" : ""}`}>
          <div className="admin-drawer__header">
            <div>
              <p className="eyebrow">管理员二级面板</p>
              <h2>控场中心</h2>
            </div>
            <button className="ghost-button" onClick={() => setShowAdminPanel(false)}>
              关闭
            </button>
          </div>

          <div className="admin-drawer__content">
            <section className="admin-card">
              <h3>牌局控制</h3>
              <div className="admin-actions">
                <button className="accent-button" onClick={() => handle(() => emitAck("game:start", { roomCode: room.roomCode }))}>
                  开始手牌
                </button>
                <button className="ghost-button" onClick={() => handle(() => emitAck("admin:pause", { roomCode: room.roomCode }))}>
                  暂停牌局
                </button>
                <button className="ghost-button" onClick={() => handle(() => emitAck("admin:resume", { roomCode: room.roomCode }))}>
                  恢复牌局
                </button>
                <button className="ghost-button" onClick={() => handle(() => emitAck("admin:end_hand", { roomCode: room.roomCode }))}>
                  结束当前手牌
                </button>
              </div>
            </section>

            <section className="admin-card">
              <h3>玩家筹码</h3>
              <label>
                选择玩家
                <select
                  value={adminTarget}
                  onChange={(event) => {
                    setAdminTarget(event.target.value);
                    const target = seatedPlayers.find((seat) => seat.playerId === event.target.value);
                    if (target) {
                      setAdminChips(String(target.stack));
                    }
                  }}
                >
                  {seatedPlayers.map((seat) => (
                    <option key={seat.playerId} value={seat.playerId}>
                      {seat.nickname}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                目标筹码
                <input value={adminChips} onChange={(event) => setAdminChips(event.target.value)} />
              </label>
              <div className="admin-actions">
                <button
                  className="accent-button"
                  disabled={!selectedPlayer}
                  onClick={() =>
                    handle(async () => {
                      if (!selectedPlayer) return;
                      await emitAck<RoomView>("admin:set_chips", {
                        roomCode: room.roomCode,
                        targetPlayerId: selectedPlayer.playerId,
                        chips: Number(adminChips),
                      });
                    })
                  }
                >
                  修改筹码
                </button>
                <button
                  className="ghost-button"
                  disabled={!selectedPlayer}
                  onClick={() =>
                    handle(async () => {
                      if (!selectedPlayer) return;
                      await emitAck<RoomView>("admin:kick", {
                        roomCode: room.roomCode,
                        targetPlayerId: selectedPlayer.playerId,
                      });
                    })
                  }
                >
                  请出房间
                </button>
              </div>
            </section>

            <section className="admin-card">
              <h3>管理日志</h3>
              <div className="admin-loglist">
                {room.auditLogs.map((log) => (
                  <AuditRow key={log.id} log={log} />
                ))}
              </div>
            </section>
          </div>
        </div>
      ) : null}

      {settlement ? <SettlementOverlay settlement={settlement} viewerId={room.viewerPlayerId} /> : null}
    </div>
  );
}

function PlayerSeatCard(props: { seat: SeatView; isWinner: boolean; isViewer: boolean }) {
  const { seat, isWinner, isViewer } = props;
  const hidden = seat.visibleCards.length === 0;

  return (
    <div
      className={[
        "seat-card",
        "seat-card--table",
        seat.isTurn ? "is-turn" : "",
        seat.folded ? "is-folded" : "",
        isWinner ? "is-winner" : "",
        isViewer ? "is-viewer" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="seat-card__header">
        <strong>{seat.nickname}</strong>
        <span>{seat.connected ? "在线" : "离线"}</span>
      </div>
      <div className="seat-badges">
        {seat.isDealer ? <span>D</span> : null}
        {seat.isSmallBlind ? <span>SB</span> : null}
        {seat.isBigBlind ? <span>BB</span> : null}
        {seat.allIn ? <span>全下</span> : null}
      </div>
      <div className="seat-card__stack">筹码 {seat.stack}</div>
      <div className="seat-card__commit">已投 {seat.totalCommitted}</div>
      <div className="seat-cards seat-cards--table">
        <CardFace card={seat.visibleCards[0]} hidden={hidden} />
        <CardFace card={seat.visibleCards[1]} hidden={hidden} />
      </div>
    </div>
  );
}

function SettlementOverlay(props: { settlement: SettlementState; viewerId: string }) {
  const { settlement, viewerId } = props;
  const viewerWon = settlement.winners.some((winner) => winner.playerId === viewerId);

  return (
    <div className="settlement-overlay">
      <div className={`settlement-panel ${viewerWon ? "is-victory" : "is-defeat"}`}>
        <p className="eyebrow">{settlement.specialResult ? "大局结算" : "本手结算"}</p>
        <h2>{settlement.title}</h2>
        <div className="settlement-banner">
          {viewerWon ? "你赢下了这一手" : settlement.specialResult ? "本大局结果已确认" : "本手赢家已经确定"}
        </div>
        <div className="settlement-list">
          {settlement.winners.map((winner) => (
            <div key={`${settlement.handId}-${winner.playerId}`} className="settlement-row">
              <div className="settlement-row__main">
                <strong>{winner.nickname}</strong>
                <span>{winner.bestFiveCards.length ? winner.handName : "未摊牌直接获胜"}</span>
                <b>+{winner.amount}</b>
              </div>
              {winner.bestFiveCards.length && winner.handDescription ? (
                <div className="settlement-row__detail">{winner.handDescription}</div>
              ) : null}
              {winner.bestFiveCards.length ? (
                <div className="settlement-combo">
                  <span className="settlement-combo__label">组成牌：</span>
                  <strong>{formatCards(winner.bestFiveCards)}</strong>
                </div>
              ) : null}
            </div>
          ))}
        </div>
        {settlement.specialResult ? (
          <div className="ranking-panel">
            <div className="ranking-panel__title">{settlement.specialResult.reason}</div>
            {settlement.specialResult.redPacketNickname ? (
              <div className="ranking-panel__notice">
                请 <strong>{settlement.specialResult.redPacketNickname}</strong> 发红包
              </div>
            ) : null}
            <div className="ranking-list">
              {settlement.specialResult.rankings.map((entry) => (
                <div
                  key={`${settlement.handId}-${entry.playerId}-rank`}
                  className={`ranking-row ${entry.shouldSendRedPacket ? "is-highlight" : ""}`}
                >
                  <span>第 {entry.rank} 名</span>
                  <strong>{entry.nickname}</strong>
                  <b>{entry.chips}</b>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ChatBarrage({ messages }: { messages: ChatMessage[] }) {
  const latestMessages = messages.slice(-8);

  return (
    <div className="chat-barrage">
      {latestMessages.map((message, index) => (
        <div
          key={message.id}
          className="chat-barrage__item"
          style={
            {
              "--track-top": `${CHAT_TRACKS[index % CHAT_TRACKS.length]}%`,
              "--duration": `${13 + (index % 4)}s`,
              "--delay": `${index * 0.2}s`,
            } as React.CSSProperties
          }
        >
          <strong>{message.nickname}</strong>
          <span>{message.text}</span>
        </div>
      ))}
    </div>
  );
}

function AuditRow({ log }: { log: AdminAuditLog }) {
  return (
    <div className="admin-logrow">
      <strong>{log.actorNickname}</strong>
      <span>{log.message}</span>
    </div>
  );
}
