import type { Card, Rank, Suit } from "@poker/shared";

const SUITS: Suit[] = ["clubs", "diamonds", "hearts", "spades"];
const RANKS: Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];

export function createDeck(): Card[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
}

export function shuffleDeck(deck: Card[]): Card[] {
  const copy = [...deck];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    const temp = copy[index];
    copy[index] = copy[target];
    copy[target] = temp;
  }
  return copy;
}

