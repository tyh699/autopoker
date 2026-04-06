import { Pool, type QueryResultRow } from "pg";
import type {
  ChipRankingEntry,
  ChatMessage,
  LeaderboardItem,
  RoomLeaderboardItem,
  RoomSettlementSnapshot,
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

  async saveRankedRoundResult(params: {
    roomCode: string;
    roundId: string;
    triggerType: "bankrupt" | "manual";
    settledAt: string;
    waterUpCount: number;
    bankruptCount: number;
    rankings: ChipRankingEntry[];
  }): Promise<void> {
    for (const entry of params.rankings) {
      await this.safeQuery(
        `INSERT INTO room_round_results (
           room_code,
           round_id,
           trigger_type,
           settled_at,
           water_up_count,
           bankrupt_count,
           user_id,
           player_id,
           nickname,
           chips,
           rank,
           is_tied,
           rank_points,
           chip_points,
           bankrupt_penalty,
           champion_bonus,
           total_points
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (room_code, round_id, user_id) DO UPDATE
         SET nickname = EXCLUDED.nickname,
             chips = EXCLUDED.chips,
             rank = EXCLUDED.rank,
             is_tied = EXCLUDED.is_tied,
             rank_points = EXCLUDED.rank_points,
             chip_points = EXCLUDED.chip_points,
             bankrupt_penalty = EXCLUDED.bankrupt_penalty,
             champion_bonus = EXCLUDED.champion_bonus,
             total_points = EXCLUDED.total_points`,
        [
          params.roomCode,
          params.roundId,
          params.triggerType,
          params.settledAt,
          params.waterUpCount,
          params.bankruptCount,
          entry.userId,
          entry.playerId,
          entry.nickname,
          entry.chips,
          entry.rank,
          entry.isTied,
          entry.rankPoints,
          entry.chipPoints,
          entry.bankruptPenalty,
          entry.championBonus,
          entry.totalPoints,
        ],
      );

      await this.safeQuery(
        `INSERT INTO room_leaderboard_stats (
           room_code,
           user_id,
           nickname,
           rounds_played,
           rounds_won,
           bankrupt_count,
           total_points
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (room_code, user_id) DO UPDATE
         SET nickname = EXCLUDED.nickname,
             rounds_played = room_leaderboard_stats.rounds_played + EXCLUDED.rounds_played,
             rounds_won = room_leaderboard_stats.rounds_won + EXCLUDED.rounds_won,
             bankrupt_count = room_leaderboard_stats.bankrupt_count + EXCLUDED.bankrupt_count,
             total_points = room_leaderboard_stats.total_points + EXCLUDED.total_points,
             updated_at = NOW()`,
        [
          params.roomCode,
          entry.userId,
          entry.nickname,
          1,
          entry.rank === 1 ? 1 : 0,
          entry.chips === 0 ? 1 : 0,
          entry.totalPoints,
        ],
      );
    }
  }

  async listRoomLeaderboard(roomCode: string, limit: number): Promise<RoomLeaderboardItem[]> {
    const rows = await this.safeQueryRows<RoomLeaderboardItem>(
      `SELECT
         room_code AS "roomCode",
         user_id AS "userId",
         nickname AS "nickname",
         rounds_played AS "roundsPlayed",
         rounds_won AS "roundsWon",
         bankrupt_count AS "bankruptCount",
         total_points AS "totalPoints",
         updated_at AS "updatedAt"
       FROM room_leaderboard_stats
       WHERE room_code = $1
       ORDER BY total_points DESC, rounds_won DESC, rounds_played DESC
       LIMIT $2`,
      [roomCode, limit],
    );
    return rows.map((row) => ({
      ...row,
      roundsPlayed: Number(row.roundsPlayed),
      roundsWon: Number(row.roundsWon),
      bankruptCount: Number(row.bankruptCount),
      totalPoints: Number(row.totalPoints),
    }));
  }

  async createRoomSettlementSnapshot(params: {
    snapshotId: string;
    roomCode: string;
    createdByUserId: string;
    note: string;
  }): Promise<void> {
    await this.safeQuery(
      `INSERT INTO room_settlement_snapshots (snapshot_id, room_code, created_by_user_id, note)
       VALUES ($1, $2, $3, $4)`,
      [params.snapshotId, params.roomCode, params.createdByUserId, params.note],
    );
  }

  async saveRoomSettlementEntry(params: {
    snapshotId: string;
    roomCode: string;
    userId: string;
    nickname: string;
    roundsPlayed: number;
    roundsWon: number;
    bankruptCount: number;
    totalPoints: number;
    details: Array<{ roundId: string; settledAt: string; points: number; rank: number; chips: number }>;
  }): Promise<void> {
    await this.safeQuery(
      `INSERT INTO room_settlement_entries (
         snapshot_id,
         room_code,
         user_id,
         nickname,
         rounds_played,
         rounds_won,
         bankrupt_count,
         total_points,
         details_json
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        params.snapshotId,
        params.roomCode,
        params.userId,
        params.nickname,
        params.roundsPlayed,
        params.roundsWon,
        params.bankruptCount,
        params.totalPoints,
        JSON.stringify(params.details),
      ],
    );
  }

  async listRoomRoundDetails(roomCode: string, userId: string): Promise<
    Array<{ roundId: string; settledAt: string; points: number; rank: number; chips: number }>
  > {
    const rows = await this.safeQueryRows<{
      roundId: string;
      settledAt: string;
      points: number;
      rank: number;
      chips: number;
    }>(
      `SELECT
         round_id AS "roundId",
         settled_at AS "settledAt",
         total_points AS "points",
         rank AS "rank",
         chips AS "chips"
       FROM room_round_results
       WHERE room_code = $1 AND user_id = $2
       ORDER BY settled_at ASC`,
      [roomCode, userId],
    );
    return rows.map((row) => ({ ...row, points: Number(row.points), rank: Number(row.rank), chips: Number(row.chips) }));
  }

  async listRoomSettlementSnapshots(roomCode: string, limit: number): Promise<RoomSettlementSnapshot[]> {
    const snapshots = await this.safeQueryRows<{
      snapshotId: string;
      roomCode: string;
      createdByUserId: string;
      createdAt: string;
      note: string;
    }>(
      `SELECT
         snapshot_id AS "snapshotId",
         room_code AS "roomCode",
         created_by_user_id AS "createdByUserId",
         created_at AS "createdAt",
         note AS "note"
       FROM room_settlement_snapshots
       WHERE room_code = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [roomCode, limit],
    );

    const results: RoomSettlementSnapshot[] = [];
    for (const snapshot of snapshots) {
      const entries = await this.safeQueryRows<{
        userId: string;
        nickname: string;
        totalPoints: number;
        roundsPlayed: number;
        roundsWon: number;
        bankruptCount: number;
        details: Array<{ roundId: string; settledAt: string; points: number; rank: number; chips: number }>;
      }>(
        `SELECT
           user_id AS "userId",
           nickname AS "nickname",
           total_points AS "totalPoints",
           rounds_played AS "roundsPlayed",
           rounds_won AS "roundsWon",
           bankrupt_count AS "bankruptCount",
           details_json AS "details"
         FROM room_settlement_entries
         WHERE snapshot_id = $1
         ORDER BY total_points DESC`,
        [snapshot.snapshotId],
      );
      results.push({
        snapshotId: snapshot.snapshotId,
        roomCode: snapshot.roomCode,
        createdByUserId: snapshot.createdByUserId,
        createdAt: snapshot.createdAt,
        note: snapshot.note,
        entries: entries.map((entry) => ({
          ...entry,
          totalPoints: Number(entry.totalPoints),
          roundsPlayed: Number(entry.roundsPlayed),
          roundsWon: Number(entry.roundsWon),
          bankruptCount: Number(entry.bankruptCount),
          details: Array.isArray(entry.details) ? entry.details : [],
        })),
      });
    }
    return results;
  }
}
