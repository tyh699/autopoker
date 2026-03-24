import { describe, expect, it } from "vitest";
import type { Card } from "@poker/shared";
import { compareHands, evaluateBestHand } from "../src/hand-evaluator";

describe("hand-evaluator", () => {
  it("prefers a straight flush over a full house", () => {
    const straightFlush: Card[] = [
      { rank: "A", suit: "spades" },
      { rank: "K", suit: "spades" },
      { rank: "Q", suit: "spades" },
      { rank: "J", suit: "spades" },
      { rank: "T", suit: "spades" },
      { rank: "2", suit: "clubs" },
      { rank: "2", suit: "diamonds" },
    ];
    const fullHouse: Card[] = [
      { rank: "A", suit: "clubs" },
      { rank: "A", suit: "diamonds" },
      { rank: "A", suit: "hearts" },
      { rank: "K", suit: "clubs" },
      { rank: "K", suit: "hearts" },
      { rank: "4", suit: "spades" },
      { rank: "3", suit: "spades" },
    ];

    const left = evaluateBestHand(straightFlush);
    const right = evaluateBestHand(fullHouse);

    expect(left.name).toBe("皇家同花顺");
    expect(compareHands(left, right)).toBeGreaterThan(0);
  });

  it("recognizes ace-low straights and returns the exact five cards", () => {
    const wheel: Card[] = [
      { rank: "A", suit: "clubs" },
      { rank: "2", suit: "diamonds" },
      { rank: "3", suit: "hearts" },
      { rank: "4", suit: "spades" },
      { rank: "5", suit: "clubs" },
      { rank: "K", suit: "hearts" },
      { rank: "Q", suit: "spades" },
    ];

    const hand = evaluateBestHand(wheel);

    expect(hand.name).toBe("顺子");
    expect(hand.description).toContain("5");
    expect(hand.bestFiveCards.map((card) => card.rank)).toEqual(["5", "4", "3", "2", "A"]);
  });

  it("compares one pair by pair rank first", () => {
    const pairOfAces = evaluateBestHand([
      { rank: "A", suit: "clubs" },
      { rank: "A", suit: "diamonds" },
      { rank: "K", suit: "hearts" },
      { rank: "9", suit: "spades" },
      { rank: "7", suit: "clubs" },
      { rank: "4", suit: "hearts" },
      { rank: "2", suit: "spades" },
    ]);
    const pairOfKings = evaluateBestHand([
      { rank: "K", suit: "clubs" },
      { rank: "K", suit: "diamonds" },
      { rank: "A", suit: "hearts" },
      { rank: "Q", suit: "spades" },
      { rank: "8", suit: "clubs" },
      { rank: "4", suit: "diamonds" },
      { rank: "2", suit: "clubs" },
    ]);

    expect(compareHands(pairOfAces, pairOfKings)).toBeGreaterThan(0);
  });

  it("compares one pair with kickers when the pair rank is the same", () => {
    const aceKicker = evaluateBestHand([
      { rank: "A", suit: "clubs" },
      { rank: "A", suit: "diamonds" },
      { rank: "K", suit: "hearts" },
      { rank: "Q", suit: "spades" },
      { rank: "9", suit: "clubs" },
      { rank: "5", suit: "hearts" },
      { rank: "2", suit: "spades" },
    ]);
    const queenKicker = evaluateBestHand([
      { rank: "A", suit: "hearts" },
      { rank: "A", suit: "spades" },
      { rank: "Q", suit: "clubs" },
      { rank: "J", suit: "diamonds" },
      { rank: "9", suit: "hearts" },
      { rank: "5", suit: "clubs" },
      { rank: "2", suit: "diamonds" },
    ]);

    expect(compareHands(aceKicker, queenKicker)).toBeGreaterThan(0);
  });

  it("returns the exact winning two-pair combination", () => {
    const hand = evaluateBestHand([
      { rank: "A", suit: "clubs" },
      { rank: "K", suit: "diamonds" },
      { rank: "A", suit: "hearts" },
      { rank: "K", suit: "spades" },
      { rank: "Q", suit: "clubs" },
      { rank: "8", suit: "hearts" },
      { rank: "2", suit: "diamonds" },
    ]);

    expect(hand.name).toBe("两对");
    expect(hand.bestFiveCards.map((card) => card.rank)).toEqual(["A", "A", "K", "K", "Q"]);
  });
});
