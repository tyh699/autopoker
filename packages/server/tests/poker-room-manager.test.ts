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

  it("builds red-packet rankings when a player busts", () => {
    const manager = createManager() as any;
    const room = {
      config: {
        maxPlayers: 6,
        startingChips: 2000,
        smallBlind: 10,
        bigBlind: 20,
        actionSeconds: 20,
        allowMidHandJoin: true,
        gameMode: "red_packet_bust",
      },
      players: new Map([
        ["a", { id: "a", nickname: "甲", seatIndex: 0, chips: 4100, pendingKick: false }],
        ["b", { id: "b", nickname: "乙", seatIndex: 1, chips: 2600, pendingKick: false }],
        ["c", { id: "c", nickname: "丙", seatIndex: 2, chips: 1800, pendingKick: false }],
        ["d", { id: "d", nickname: "丁", seatIndex: 3, chips: 900, pendingKick: false }],
        ["e", { id: "e", nickname: "戊", seatIndex: 4, chips: 0, pendingKick: false }],
        ["f", { id: "f", nickname: "己", seatIndex: 5, chips: 600, pendingKick: false }],
      ]),
    };

    const result = manager.buildSpecialGameResult(room);

    expect(result?.mode).toBe("red_packet_bust");
    expect(result?.redPacketNickname).toBe("丁");
    expect(result?.rankings.map((entry: { nickname: string }) => entry.nickname)).toEqual(["甲", "乙", "丙", "丁", "己", "戊"]);
    expect(result?.rankings.find((entry: { nickname: string }) => entry.nickname === "丁")?.shouldSendRedPacket).toBe(true);
  });
});
