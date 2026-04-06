import { describe, expect, it } from "vitest";
import { calculateRankedRound } from "../src/ranked-scoring";

describe("ranked scoring", () => {
  it("keeps total score balanced for 6 players with one bankrupt", () => {
    const { rankings, bankruptCount, waterUpCount } = calculateRankedRound([
      { playerId: "a", userId: "u1", nickname: "甲", chips: 2200 },
      { playerId: "b", userId: "u2", nickname: "乙", chips: 1400 },
      { playerId: "c", userId: "u3", nickname: "丙", chips: 900 },
      { playerId: "d", userId: "u4", nickname: "丁", chips: 800 },
      { playerId: "e", userId: "u5", nickname: "戊", chips: 700 },
      { playerId: "f", userId: "u6", nickname: "己", chips: 0 },
    ]);
    expect(waterUpCount).toBe(2);
    expect(bankruptCount).toBe(1);
    expect(rankings[0].championBonus).toBe(8);
    expect(rankings[5].bankruptPenalty).toBe(-8);
    const total = rankings.reduce((sum, entry) => sum + entry.totalPoints, 0);
    expect(total).toBe(0);
  });

  it("averages rank points for ties and keeps one decimal", () => {
    const { rankings } = calculateRankedRound([
      { playerId: "a", userId: "u1", nickname: "甲", chips: 2800 },
      { playerId: "b", userId: "u2", nickname: "乙", chips: 2200 },
      { playerId: "c", userId: "u3", nickname: "丙", chips: 500 },
      { playerId: "d", userId: "u4", nickname: "丁", chips: 500 },
      { playerId: "e", userId: "u5", nickname: "戊", chips: 0 },
      { playerId: "f", userId: "u6", nickname: "己", chips: 0 },
    ]);
    expect(rankings[2].rankPoints).toBe(-2);
    expect(rankings[3].rankPoints).toBe(-2);
    expect(rankings[4].rankPoints).toBe(-8);
    expect(rankings[5].rankPoints).toBe(-8);
    const total = rankings.reduce((sum, entry) => sum + entry.totalPoints, 0);
    expect(total).toBe(0);
  });

  it("supports 4 players and keeps score balanced", () => {
    const { rankings } = calculateRankedRound([
      { playerId: "a", userId: "u1", nickname: "甲", chips: 1600 },
      { playerId: "b", userId: "u2", nickname: "乙", chips: 1100 },
      { playerId: "c", userId: "u3", nickname: "丙", chips: 900 },
      { playerId: "d", userId: "u4", nickname: "丁", chips: 400 },
    ]);
    expect(rankings.length).toBe(4);
    expect(rankings[0].totalPoints).toBeGreaterThan(0);
    expect(rankings[3].totalPoints).toBeLessThan(0);
    const total = rankings.reduce((sum, entry) => sum + entry.totalPoints, 0);
    expect(total).toBe(0);
  });
});
