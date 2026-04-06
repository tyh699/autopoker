import type { ChipRankingEntry } from "@poker/shared";

interface RankedPlayerInput {
  playerId: string;
  userId: string;
  nickname: string;
  chips: number;
}

const RANK_POINTS_TABLE: Record<number, Record<number, number[]>> = {
  4: {
    1: [12, -1, -3, -8],
    2: [8, 4, -4, -8],
    3: [8, 3, 1, -12],
  },
  5: {
    1: [16, -1, -2, -4, -9],
    2: [10, 6, -2, -5, -9],
    3: [9, 4, 3, -4, -12],
    4: [9, 4, 2, 1, -16],
  },
  6: {
    1: [20, -1, -2, -3, -5, -9],
    2: [12, 8, -1, -3, -6, -10],
    3: [10, 6, 4, -2, -6, -12],
    4: [10, 5, 3, 2, -4, -16],
    5: [10, 4, 3, 2, 1, -20],
  },
  7: {
    1: [24, -1, -2, -3, -4, -5, -9],
    2: [14, 10, -1, -2, -4, -7, -10],
    3: [12, 7, 5, -1, -3, -8, -12],
    4: [11, 7, 4, 2, -2, -8, -14],
    5: [11, 6, 4, 2, 1, -4, -20],
    6: [11, 4, 3, 3, 2, 1, -24],
  },
};

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function getRankPointsByTie(rankPoints: number[], orderedPlayers: RankedPlayerInput[]): number[] {
  const result = new Array<number>(orderedPlayers.length).fill(0);
  let index = 0;
  while (index < orderedPlayers.length) {
    let end = index;
    while (end + 1 < orderedPlayers.length && orderedPlayers[end + 1].chips === orderedPlayers[index].chips) {
      end += 1;
    }
    const slice = rankPoints.slice(index, end + 1);
    const average = round1(slice.reduce((sum, value) => sum + value, 0) / slice.length);
    for (let i = index; i <= end; i += 1) {
      result[i] = average;
    }
    index = end + 1;
  }
  return result;
}

export function calculateRankedRound(players: RankedPlayerInput[]): {
  rankings: ChipRankingEntry[];
  waterUpCount: number;
  bankruptCount: number;
} {
  if (players.length < 4 || players.length > 7) {
    throw new Error("排位赛仅支持 4-7 人结算");
  }
  const waterUpCount = players.filter((entry) => entry.chips > 1000).length;
  const bankruptCount = players.filter((entry) => entry.chips === 0).length;
  const rankPoints = RANK_POINTS_TABLE[players.length]?.[waterUpCount];
  if (!rankPoints) {
    throw new Error(`人数 ${players.length} 与水上人数 ${waterUpCount} 的顺位点未配置`);
  }

  const ordered = [...players].sort((left, right) => {
    if (right.chips !== left.chips) {
      return right.chips - left.chips;
    }
    return left.nickname.localeCompare(right.nickname);
  });
  const tiedRankPoints = getRankPointsByTie(rankPoints, ordered);
  const championBonus = bankruptCount * 8;

  const rankings: ChipRankingEntry[] = ordered.map((entry, index) => {
    const chipPoints = round1((entry.chips - 1000) / 25);
    const bankruptPenalty = entry.chips === 0 ? -8 : 0;
    const rankPoint = tiedRankPoints[index];
    const bonus = index === 0 ? championBonus : 0;
    const totalPoints = round1(rankPoint + chipPoints + bankruptPenalty + bonus);
    const previous = index > 0 ? ordered[index - 1] : null;
    return {
      playerId: entry.playerId,
      userId: entry.userId,
      nickname: entry.nickname,
      chips: entry.chips,
      rank: index + 1,
      isTied: Boolean(previous && previous.chips === entry.chips),
      rankPoints: rankPoint,
      chipPoints,
      bankruptPenalty,
      championBonus: bonus,
      totalPoints,
    };
  });

  return { rankings, waterUpCount, bankruptCount };
}
