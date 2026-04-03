import { Pool, type QueryResultRow } from "pg";
import type {
  ChatMessage,
  LeaderboardItem,
  RoomConfig,
  RoomHandHistoryItem,
  UserHandHistoryItem,
  WinnerSummary,
} from "@poker/shared";

export class Persistence {
  private readonly pool?: Pool;

  constructor(databaseUrl?: string) {
    if (databaseUrl) {
      this.pool = new Pool({ connectionString: databaseUrl });
    }
  }

  async close(): Promise<void> {
    await this.pool?.end();
  }

  private async safeQuery(query: string, values: unknown[]): Promise<void> {
    if (!this.pool) {
      return;
    }
    try {
      await this.pool.query(query, values);
    } catch (error) {
      console.error("Persistence query failed:", error);
    }
  }

  private async safeQueryRows<T extends QueryResultRow>(query: string, values: unknown[]): Promise<T[]> {
    if (!this.pool) {
      return [];
    }
    try {
      const result = await this.pool.query<T>(query, values);
      return result.rows;
    } catch (error) {
      console.error("Persistence query failed:", error);
      return [];
    }
  }

  async saveUserProfile(params: { userId: string; email: string | null; nickname: string }): Promise<void> {
    await this.safeQuery(
      `INSERT INTO app_users (user_id, email, display_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE
       SET email = EXCLUDED.email,
           display_name = EXCLUDED.display_name,
           updated_at = NOW()`,
      [params.userId, params.email, params.nickname],
    );
  }

  async saveRoomCreated(roomCode: string, hostPlayerId: string, hostUserId: string, config: RoomConfig): Promise<void> {
    await this.safeQuery(
      `INSERT INTO rooms (room_code, host_player_id, host_user_id, config_json)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (room_code) DO UPDATE
       SET host_player_id = EXCLUDED.host_player_id,
           host_user_id = EXCLUDED.host_user_id,
           config_json = EXCLUDED.config_json`,
      [roomCode, hostPlayerId, hostUserId, JSON.stringify(config)],
    );
  }

  async savePlayerState(params: {
    roomCode: string;
    playerId: string;
    userId: string;
    nickname: string;
    seatIndex: number | null;
    stack: number;
    isHost: boolean;
  }): Promise<void> {
    await this.safeQuery(
      `INSERT INTO room_players (room_code, player_id, user_id, nickname, seat_index, stack, is_host)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (room_code, player_id) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           nickname = EXCLUDED.nickname,
           seat_index = EXCLUDED.seat_index,
           stack = EXCLUDED.stack,
           is_host = EXCLUDED.is_host`,
      [params.roomCode, params.playerId, params.userId, params.nickname, params.seatIndex, params.stack, params.isHost],
    );
  }

  async saveHandStarted(params: {
    handId: string;
    roomCode: string;
    street: string;
    communityCards: unknown;
    startedAt: string;
  }): Promise<void> {
    await this.safeQuery(
      `INSERT INTO hands (hand_id, room_code, street, community_cards, started_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (hand_id) DO UPDATE
       SET street = EXCLUDED.street,
           community_cards = EXCLUDED.community_cards`,
      [params.handId, params.roomCode, params.street, JSON.stringify(params.communityCards), params.startedAt],
    );
  }

  async saveHandAction(params: {
    handId: string;
    roomCode: string;
    playerId: string;
    userId: string;
    nickname: string;
    street: string;
    actionType: string;
    amount: number | null;
  }): Promise<void> {
    await this.safeQuery(
      `INSERT INTO hand_actions (hand_id, room_code, player_id, user_id, nickname, street, action_type, amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        params.handId,
        params.roomCode,
        params.playerId,
        params.userId,
        params.nickname,
        params.street,
        params.actionType,
        params.amount,
      ],
    );
  }

  async saveHandResult(params: {
    handId: string;
    roomCode: string;
    street: string;
    communityCards: unknown;
    winners: WinnerSummary[];
  }): Promise<void> {
    await this.safeQuery(
      `UPDATE hands
       SET street = $3,
           community_cards = $4,
           winners_json = $5,
           finished_at = NOW()
       WHERE hand_id = $1 AND room_code = $2`,
      [params.handId, params.roomCode, params.street, JSON.stringify(params.communityCards), JSON.stringify(params.winners)],
    );
  }

  async saveHandPlayerResult(params: {
    handId: string;
    roomCode: string;
    userId: string;
    playerId: string;
    nickname: string;
    chipsAtHandStart: number;
    endChips: number;
    deltaChips: number;
    wonAmount: number;
    isWinner: boolean;
    winningHandName: string | null;
  }): Promise<void> {
    await this.safeQuery(
      `INSERT INTO hand_player_results (
         hand_id,
         room_code,
         user_id,
         player_id,
         nickname,
         chips_at_hand_start,
         end_chips,
         delta_chips,
         won_amount,
         is_winner,
         winning_hand_name
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (hand_id, user_id) DO UPDATE
       SET player_id = EXCLUDED.player_id,
           nickname = EXCLUDED.nickname,
           chips_at_hand_start = EXCLUDED.chips_at_hand_start,
           end_chips = EXCLUDED.end_chips,
           delta_chips = EXCLUDED.delta_chips,
           won_amount = EXCLUDED.won_amount,
           is_winner = EXCLUDED.is_winner,
           winning_hand_name = EXCLUDED.winning_hand_name`,
      [
        params.handId,
        params.roomCode,
        params.userId,
        params.playerId,
        params.nickname,
        params.chipsAtHandStart,
        params.endChips,
        params.deltaChips,
        params.wonAmount,
        params.isWinner,
        params.winningHandName,
      ],
    );
  }

  async saveUserStatsDelta(params: {
    userId: string;
    handsPlayedInc: number;
    handsWonInc: number;
    netChipsInc: number;
  }): Promise<void> {
    await this.safeQuery(
      `INSERT INTO user_stats (user_id, hands_played, hands_won, net_chips)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE
       SET hands_played = user_stats.hands_played + EXCLUDED.hands_played,
           hands_won = user_stats.hands_won + EXCLUDED.hands_won,
           net_chips = user_stats.net_chips + EXCLUDED.net_chips,
           updated_at = NOW()`,
      [params.userId, params.handsPlayedInc, params.handsWonInc, params.netChipsInc],
    );
  }

  async saveChipAdjustment(params: {
    roomCode: string;
    handId: string | null;
    actorPlayerId: string;
    actorUserId: string;
    targetPlayerId: string;
    targetUserId: string;
    beforeValue: number;
    afterValue: number;
  }): Promise<void> {
    await this.safeQuery(
      `INSERT INTO chip_adjustments (
         room_code,
         hand_id,
         actor_player_id,
         actor_user_id,
         target_player_id,
         target_user_id,
         before_value,
         after_value
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        params.roomCode,
        params.handId,
        params.actorPlayerId,
        params.actorUserId,
        params.targetPlayerId,
        params.targetUserId,
        params.beforeValue,
        params.afterValue,
      ],
    );
  }

  async saveChatMessage(message: ChatMessage, userId: string): Promise<void> {
    await this.safeQuery(
      `INSERT INTO chat_messages (id, room_code, player_id, user_id, nickname, text, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [message.id, message.roomCode, message.playerId, userId, message.nickname, message.text, message.createdAt],
    );
  }

  async listUserHandHistory(userId: string, limit: number): Promise<UserHandHistoryItem[]> {
    const rows = await this.safeQueryRows<{
      handId: string;
      roomCode: string;
      nickname: string;
      startedAt: string;
      finishedAt: string | null;
      wonAmount: number;
      deltaChips: number;
      isWinner: boolean;
      winningHandName: string | null;
    }>(
      `SELECT
         hpr.hand_id AS "handId",
         hpr.room_code AS "roomCode",
         hpr.nickname AS "nickname",
         h.started_at AS "startedAt",
         h.finished_at AS "finishedAt",
         hpr.won_amount AS "wonAmount",
         hpr.delta_chips AS "deltaChips",
         hpr.is_winner AS "isWinner",
         hpr.winning_hand_name AS "winningHandName"
       FROM hand_player_results hpr
       JOIN hands h ON h.hand_id = hpr.hand_id
       WHERE hpr.user_id = $1
       ORDER BY h.started_at DESC
       LIMIT $2`,
      [userId, limit],
    );

    return rows.map((row) => ({
      ...row,
      wonAmount: Number(row.wonAmount),
      deltaChips: Number(row.deltaChips),
    }));
  }

  async listLeaderboard(limit: number): Promise<LeaderboardItem[]> {
    const rows = await this.safeQueryRows<LeaderboardItem>(
      `SELECT
         us.user_id AS "userId",
         COALESCE(NULLIF(au.display_name, ''), '玩家') AS "nickname",
         us.hands_played AS "handsPlayed",
         us.hands_won AS "handsWon",
         us.net_chips AS "netChips"
       FROM user_stats us
       LEFT JOIN app_users au ON au.user_id = us.user_id
       ORDER BY us.net_chips DESC, us.hands_won DESC, us.hands_played DESC
       LIMIT $1`,
      [limit],
    );

    return rows.map((row) => ({
      ...row,
      handsPlayed: Number(row.handsPlayed),
      handsWon: Number(row.handsWon),
      netChips: Number(row.netChips),
    }));
  }

  async listRoomHands(roomCode: string, limit: number, before?: string): Promise<RoomHandHistoryItem[]> {
    const rows = await this.safeQueryRows<{
      handId: string;
      roomCode: string;
      street: RoomHandHistoryItem["street"];
      startedAt: string;
      finishedAt: string | null;
      winners: WinnerSummary[];
    }>(
      `SELECT
         hand_id AS "handId",
         room_code AS "roomCode",
         street AS "street",
         started_at AS "startedAt",
         finished_at AS "finishedAt",
         winners_json AS "winners"
       FROM hands
       WHERE room_code = $1
         AND ($3::timestamptz IS NULL OR started_at < $3::timestamptz)
       ORDER BY started_at DESC
       LIMIT $2`,
      [roomCode, limit, before ?? null],
    );

    return rows.map((row) => ({
      handId: row.handId,
      roomCode: row.roomCode,
      street: row.street,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      winners: Array.isArray(row.winners) ? row.winners : [],
    }));
  }
}
