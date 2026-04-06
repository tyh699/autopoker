import { describe, expect, it } from "vitest";
import type { Card } from "@poker/shared";
import { PokerRoomManager } from "../src/poker-room-manager";
import { Persistence } from "../src/persistence";

function createManager() {
  const io = {
    to() {
      return { emit() {} };
    },
  } as never;

  return new PokerRoomManager(io, new Persistence());
}

describe("poker-room-manager internals", () => {
  it("computes main pot and side pot with folded players excluded from eligibility", () => {
    const manager = createManager() as any;
    const room = {
      players: new Map([
        [
          "a",
          {
            id: "a",
            nickname: "甲",
            seatIndex: 0,
            hand: { totalCommitted: 100, folded: false },
          },
        ],
        [
          "b",
          {
            id: "b",
            nickname: "乙",
            seatIndex: 1,
            hand: { totalCommitted: 300, folded: false },
          },
        ],
        [
          "c",
          {
            id: "c",
            nickname: "丙",
            seatIndex: 2,
            hand: { totalCommitted: 300, folded: true },
          },
        ],
      ]),
    };

    const pots = manager.computeSidePots(room);

    expect(pots).toEqual([
      { amount: 300, eligiblePlayerIds: ["a", "b"] },
      { amount: 400, eligiblePlayerIds: ["b"] },
    ]);
  });

  it("offers raise and all-in when action is on the current player", () => {
    const manager = createManager() as any;
    const player = {
      id: "a",
      nickname: "甲",
      seatIndex: 0,
      chips: 900,
      hand: {
        holeCards: [] as Card[],
        folded: false,
        allIn: false,
        actedThisStreet: false,
        committedThisStreet: 100,
        totalCommitted: 100,
      },
    };
    const room = {
      hand: {
        actionSeatIndex: 0,
        currentBet: 200,
        lastFullRaise: 200,
        minRaiseTo: 400,
      },
    };

    const actions = manager.getAvailableActions(room, player);

    expect(actions.map((entry: { type: string }) => entry.type)).toEqual(["call", "fold", "all_in", "raise"]);
  });

  it("refunds uncalled chips before showdown side-pot calculation", () => {
    const manager = createManager() as any;
    const room = {
      players: new Map([
        [
          "a",
          {
            id: "a",
            nickname: "甲",
            seatIndex: 0,
            chips: 0,
            hand: { totalCommitted: 100, committedThisStreet: 100, folded: false },
          },
        ],
        [
          "b",
          {
            id: "b",
            nickname: "乙",
            seatIndex: 1,
            chips: 0,
            hand: { totalCommitted: 300, committedThisStreet: 300, folded: false },
          },
        ],
      ]),
    };

    manager.refundUncalledBet(room);
    const pots = manager.computeSidePots(room);

    expect(room.players.get("b").chips).toBe(200);
    expect(room.players.get("b").hand.totalCommitted).toBe(100);
    expect(pots).toEqual([{ amount: 200, eligiblePlayerIds: ["a", "b"] }]);
  });

  it("builds ranked settlement when a player busts", () => {
    const manager = createManager() as any;
    const room = {
      config: {
        maxPlayers: 6,
        startingChips: 1000,
        smallBlind: 10,
        bigBlind: 20,
        actionSeconds: 20,
        allowMidHandJoin: true,
        gameMode: "ranked",
      },
      players: new Map([
        ["a", { id: "a", userId: "u1", nickname: "甲", seatIndex: 0, chips: 2200, pendingKick: false }],
        ["b", { id: "b", userId: "u2", nickname: "乙", seatIndex: 1, chips: 1400, pendingKick: false }],
        ["c", { id: "c", userId: "u3", nickname: "丙", seatIndex: 2, chips: 900, pendingKick: false }],
        ["d", { id: "d", userId: "u4", nickname: "丁", seatIndex: 3, chips: 800, pendingKick: false }],
        ["e", { id: "e", userId: "u5", nickname: "戊", seatIndex: 4, chips: 700, pendingKick: false }],
        ["f", { id: "f", userId: "u6", nickname: "己", seatIndex: 5, chips: 0, pendingKick: false }],
      ]),
    };

    const result = manager.buildSpecialGameResult(room, "bankrupt");

    expect(result?.mode).toBe("ranked");
    expect(result?.trigger).toBe("bankrupt");
    expect(result?.isScored).toBe(true);
    expect(result?.bankruptCount).toBe(1);
    expect(result?.rankings[0]?.nickname).toBe("甲");
    expect(result?.rankings[0]?.championBonus).toBe(8);
    expect(result?.rankings[5]?.bankruptPenalty).toBe(-8);
  });
});
