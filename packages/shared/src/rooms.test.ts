import { describe, expect, it } from "vitest";

import { TableRankingSchema } from "./rooms.js";

describe("table ranking contract", () => {
  it("accepts the public ranking metrics and rejects activity points", () => {
    const ranking = {
      players: [{
        handsPlayed: 2,
        netResult: 30,
        nickname: "Alice",
        seatIndex: 0,
        seated: true,
        totalBuyIn: 600,
        userId: "user-a",
        voluntarilyEnteredHands: 1,
        vpip: 50,
        winningHands: 1,
        winRate: 50,
      }],
      roomId: "room-a",
      summary: { activePlayers: 1, averagePot: 90, departedPlayers: 0, elapsedSeconds: 60, handsPlayed: 2, totalBuyIn: 600, totalPot: 180 },
    };
    expect(TableRankingSchema.parse(ranking)).toEqual(ranking);
    expect(TableRankingSchema.safeParse({ ...ranking, players: [{ ...ranking.players[0], activityPoints: 99 }] }).success).toBe(false);
  });
});
