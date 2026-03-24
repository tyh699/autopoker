import type { Card, Rank } from "@poker/shared";

const RANK_VALUE: Record<Rank, number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

const VALUE_LABEL: Record<number, string> = {
  2: "2",
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "10",
  11: "J",
  12: "Q",
  13: "K",
  14: "A",
};

const SUIT_ORDER: Record<Card["suit"], number> = {
  spades: 4,
  hearts: 3,
  diamonds: 2,
  clubs: 1,
};

export interface EvaluatedHand {
  score: number[];
  name: string;
  description: string;
  bestFiveCards: Card[];
}

function compareScore(left: number[], right: number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) {
      return a > b ? 1 : -1;
    }
  }
  return 0;
}

export function compareHands(left: EvaluatedHand, right: EvaluatedHand): number {
  return compareScore(left.score, right.score);
}

function cardValue(card: Card): number {
  return RANK_VALUE[card.rank];
}

function rankLabel(value: number): string {
  return VALUE_LABEL[value] ?? String(value);
}

function sortCardsDescending(cards: Card[]): Card[] {
  return [...cards].sort((left, right) => {
    const valueDiff = cardValue(right) - cardValue(left);
    if (valueDiff !== 0) {
      return valueDiff;
    }
    return SUIT_ORDER[right.suit] - SUIT_ORDER[left.suit];
  });
}

function groupCardsByRank(cards: Card[]): Map<number, Card[]> {
  const groups = new Map<number, Card[]>();
  for (const card of sortCardsDescending(cards)) {
    const value = cardValue(card);
    groups.set(value, [...(groups.get(value) ?? []), card]);
  }
  return groups;
}

function detectStraightCards(cards: Card[]): Card[] | null {
  const uniqueByValue = new Map<number, Card>();
  for (const card of sortCardsDescending(cards)) {
    const value = cardValue(card);
    if (!uniqueByValue.has(value)) {
      uniqueByValue.set(value, card);
    }
  }

  const ordered = [...uniqueByValue.entries()].sort((left, right) => right[0] - left[0]);
  if (uniqueByValue.has(14)) {
    ordered.push([1, uniqueByValue.get(14)!]);
  }

  for (let index = 0; index <= ordered.length - 5; index += 1) {
    const run = [ordered[index]];
    for (let cursor = index + 1; cursor < ordered.length && run.length < 5; cursor += 1) {
      if (ordered[cursor][0] === run[run.length - 1][0] - 1) {
        run.push(ordered[cursor]);
      } else if (ordered[cursor][0] !== run[run.length - 1][0]) {
        break;
      }
    }
    if (run.length === 5) {
      return run.map((entry) => entry[1]);
    }
  }

  return null;
}

function describeKickers(values: number[]): string {
  return values.map(rankLabel).join(" ");
}

export function evaluateFive(cards: Card[]): EvaluatedHand {
  const sortedCards = sortCardsDescending(cards);
  const groups = groupCardsByRank(sortedCards);
  const groupEntries = [...groups.entries()].sort((left, right) => {
    if (right[1].length === left[1].length) {
      return right[0] - left[0];
    }
    return right[1].length - left[1].length;
  });
  const straightCards = detectStraightCards(sortedCards);
  const isFlush = new Set(sortedCards.map((card) => card.suit)).size === 1;

  if (isFlush && straightCards) {
    const high = cardValue(straightCards[0]);
    return {
      score: [8, high],
      name: high === 14 && cardValue(straightCards[1]) === 13 ? "皇家同花顺" : "同花顺",
      description: high === 14 && cardValue(straightCards[1]) === 13 ? "A 高皇家同花顺" : `${rankLabel(high)} 高同花顺`,
      bestFiveCards: straightCards,
    };
  }

  const fourOfAKind = groupEntries.find(([, group]) => group.length === 4);
  if (fourOfAKind) {
    const [quadValue, quadCards] = fourOfAKind;
    const kicker = sortedCards.find((card) => cardValue(card) !== quadValue)!;
    return {
      score: [7, quadValue, cardValue(kicker)],
      name: "四条",
      description: `四条 ${rankLabel(quadValue)}，踢脚 ${rankLabel(cardValue(kicker))}`,
      bestFiveCards: [...quadCards, kicker],
    };
  }

  const trips = groupEntries.filter(([, group]) => group.length === 3);
  const pairs = groupEntries.filter(([, group]) => group.length === 2);
  if (trips.length > 0 && (pairs.length > 0 || trips.length > 1)) {
    const [tripValue, tripCards] = trips[0];
    const pairEntry = pairs[0] ?? trips[1];
    const [pairValue, pairCards] = pairEntry;
    return {
      score: [6, tripValue, pairValue],
      name: "葫芦",
      description: `${rankLabel(tripValue)} 带 ${rankLabel(pairValue)}`,
      bestFiveCards: [...tripCards, ...pairCards.slice(0, 2)],
    };
  }

  if (isFlush) {
    const values = sortedCards.map(cardValue);
    return {
      score: [5, ...values],
      name: "同花",
      description: `${rankLabel(values[0])} 高同花`,
      bestFiveCards: sortedCards,
    };
  }

  if (straightCards) {
    const high = cardValue(straightCards[0]);
    return {
      score: [4, high],
      name: "顺子",
      description: `${rankLabel(high)} 高顺子`,
      bestFiveCards: straightCards,
    };
  }

  if (trips.length > 0) {
    const [tripValue, tripCards] = trips[0];
    const kickers = sortedCards.filter((card) => cardValue(card) !== tripValue).slice(0, 2);
    return {
      score: [3, tripValue, ...kickers.map(cardValue)],
      name: "三条",
      description: `三条 ${rankLabel(tripValue)}，踢脚 ${describeKickers(kickers.map(cardValue))}`,
      bestFiveCards: [...tripCards, ...kickers],
    };
  }

  if (pairs.length >= 2) {
    const [highPairValue, highPairCards] = pairs[0];
    const [lowPairValue, lowPairCards] = pairs[1];
    const kicker = sortedCards.find((card) => ![highPairValue, lowPairValue].includes(cardValue(card)))!;
    return {
      score: [2, highPairValue, lowPairValue, cardValue(kicker)],
      name: "两对",
      description: `${rankLabel(highPairValue)} 和 ${rankLabel(lowPairValue)} 两对，踢脚 ${rankLabel(cardValue(kicker))}`,
      bestFiveCards: [...highPairCards, ...lowPairCards, kicker],
    };
  }

  if (pairs.length === 1) {
    const [pairValue, pairCards] = pairs[0];
    const kickers = sortedCards.filter((card) => cardValue(card) !== pairValue).slice(0, 3);
    return {
      score: [1, pairValue, ...kickers.map(cardValue)],
      name: "一对",
      description: `一对 ${rankLabel(pairValue)}，踢脚 ${describeKickers(kickers.map(cardValue))}`,
      bestFiveCards: [...pairCards, ...kickers],
    };
  }

  const highCards = sortedCards.slice(0, 5);
  return {
    score: [0, ...highCards.map(cardValue)],
    name: "高牌",
    description: `${rankLabel(cardValue(highCards[0]))} 高牌`,
    bestFiveCards: highCards,
  };
}

function getCombinations<T>(items: T[], choose: number): T[][] {
  const result: T[][] = [];

  function visit(start: number, path: T[]): void {
    if (path.length === choose) {
      result.push([...path]);
      return;
    }

    for (let index = start; index < items.length; index += 1) {
      path.push(items[index]);
      visit(index + 1, path);
      path.pop();
    }
  }

  visit(0, []);
  return result;
}

export function evaluateBestHand(cards: Card[]): EvaluatedHand {
  const combinations = getCombinations(cards, 5);
  let best = evaluateFive(combinations[0]);

  for (let index = 1; index < combinations.length; index += 1) {
    const candidate = evaluateFive(combinations[index]);
    if (compareHands(candidate, best) > 0) {
      best = candidate;
    }
  }

  return best;
}
