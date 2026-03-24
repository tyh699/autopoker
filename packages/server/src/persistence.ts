import { Pool } from "pg";
import type { ChatMessage, RoomConfig, WinnerSummary } from "@poker/shared";

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

  async saveRoomCreated(roomCode: string, hostPlayerId: string, config: RoomConfig): Promise<void> {
    await this.safeQuery(
      `INSERT INTO rooms (room_code, host_player_id, config_json)
       VALUES ($1, $2, $3)
       ON CONFLICT (room_code) DO UPDATE
       SET host_player_id = EXCLUDED.host_player_id,
           config_json = EXCLUDED.config_json`,
      [roomCode, hostPlayerId, JSON.stringify(config)],
    );
  }

  async savePlayerState(params: {
    roomCode: string;
    playerId: string;
    nickname: string;
    seatIndex: number | null;
    stack: number;
    isHost: boolean;
  }): Promise<void> {
    await this.safeQuery(
      `INSERT INTO room_players (room_code, player_id, nickname, seat_index, stack, is_host)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (room_code, player_id) DO UPDATE
       SET nickname = EXCLUDED.nickname,
           seat_index = EXCLUDED.seat_index,
           stack = EXCLUDED.stack,
           is_host = EXCLUDED.is_host`,
      [params.roomCode, params.playerId, params.nickname, params.seatIndex, params.stack, params.isHost],
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
    nickname: string;
    street: string;
    actionType: string;
    amount: number | null;
  }): Promise<void> {
    await this.safeQuery(
      `INSERT INTO hand_actions (hand_id, room_code, player_id, nickname, street, action_type, amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        params.handId,
        params.roomCode,
        params.playerId,
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

  async saveChipAdjustment(params: {
    roomCode: string;
    handId: string | null;
    actorPlayerId: string;
    targetPlayerId: string;
    beforeValue: number;
    afterValue: number;
  }): Promise<void> {
    await this.safeQuery(
      `INSERT INTO chip_adjustments (room_code, hand_id, actor_player_id, target_player_id, before_value, after_value)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        params.roomCode,
        params.handId,
        params.actorPlayerId,
        params.targetPlayerId,
        params.beforeValue,
        params.afterValue,
      ],
    );
  }

  async saveChatMessage(message: ChatMessage): Promise<void> {
    await this.safeQuery(
      `INSERT INTO chat_messages (id, room_code, player_id, nickname, text, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [message.id, message.roomCode, message.playerId, message.nickname, message.text, message.createdAt],
    );
  }
}
