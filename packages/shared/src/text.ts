import type { GameMode, GameStreet, PlayerActionType, Rank, Suit } from "./protocol.js";

export const SUIT_SYMBOL: Record<Suit, string> = {
  clubs: "♣",
  diamonds: "♦",
  hearts: "♥",
  spades: "♠",
};

export const STREET_LABEL: Record<GameStreet, string> = {
  preflop: "翻牌前",
  flop: "翻牌",
  turn: "转牌",
  river: "河牌",
  showdown: "摊牌",
};

export const ACTION_LABEL: Record<PlayerActionType, string> = {
  check: "过牌",
  call: "跟注",
  raise: "加注",
  fold: "弃牌",
  all_in: "全下",
};

export const DISPLAY_RANK: Record<Rank, string> = {
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
  T: "10",
  J: "J",
  Q: "Q",
  K: "K",
  A: "A",
};

export const GAME_MODE_LABEL: Record<GameMode, string> = {
  classic: "经典局",
  red_packet_bust: "淘汰红包局",
};

export function formatCard(card: { rank: string; suit: Suit }): string {
  return `${DISPLAY_RANK[card.rank as Rank] ?? card.rank}${SUIT_SYMBOL[card.suit]}`;
}
