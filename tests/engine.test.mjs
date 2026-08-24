import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTeamModel,
  fixtureClashes,
  isLegalSquad,
  optimiseSquad,
  optimiseTransfers,
  pickStartingXI,
  projectPlayer,
  resolveTargetEvent,
} from "../engine.mjs";

const teams = new Map([
  [1, { id: 1, strength_attack_home: 1200, strength_attack_away: 1150, strength_defence_home: 1200, strength_defence_away: 1150 }],
  [2, { id: 2, strength_attack_home: 800, strength_attack_away: 800, strength_defence_home: 800, strength_defence_away: 800 }],
]);

test("Poisson team model respects stronger attack and weaker opposing defence", () => {
  const model = buildTeamModel([], teams, 1);
  assert.ok(model.expectedGoals(1, 2, true) > model.expectedGoals(2, 1, false));
});

test("player projection rewards an easier attacking fixture and exposes uncertainty", () => {
  const player = {
    id: 10, teamId: 1, position: "MID", minutes: 900, starts: 10, appearances: 10,
    expectedGoals: 4, expectedAssists: 3, bonus: 8, saves: 0, yellowCards: 1, redCards: 0,
    pointsPerGame: 5, selectedBy: 20, chance: 100, status: "a",
  };
  const easyModel = { expectedGoals: (teamId) => teamId === 1 ? 2.2 : 0.8, neutralGoals: () => 1.4 };
  const hardModel = { expectedGoals: (teamId) => teamId === 1 ? 0.8 : 2.2, neutralGoals: () => 1.4 };
  const base = {
    currentEvent: 5,
    fixtures: [{ event: 5, finished: false, team_h: 1, team_a: 2 }],
    historyByPlayer: { 10: [
      { event: 4, minutes: 90, total_points: 7, expected_goals: 0.4, expected_assists: 0.2 },
      { event: 3, minutes: 88, total_points: 5, expected_goals: 0.2, expected_assists: 0.3 },
    ] },
  };
  const easy = projectPlayer(player, { ...base, teamModel: easyModel }, 1, "balanced");
  const hard = projectPlayer(player, { ...base, teamModel: hardModel }, 1, "balanced");
  assert.ok(easy.projected > hard.projected);
  assert.ok(easy.ceiling >= easy.projected);
  assert.ok(easy.floor <= easy.projected);
  assert.ok(easy.expectedMinutes > 60);

  const calibrated = projectPlayer(player, {
    ...base,
    teamModel: easyModel,
    predictionCalibration: {
      calibrations: { MID: { blend: 1, scale: 0.5, offset: 0 } },
      residuals: {},
    },
  }, 1, "balanced");
  assert.equal(calibrated.structuralProjected, easy.projected);
  assert.equal(calibrated.projected, Number((easy.projected * 0.5).toFixed(2)));
});

function makePlayers() {
  const counts = { GK: 6, DEF: 14, MID: 14, FWD: 10 };
  let id = 1;
  const players = [];
  for (const [position, count] of Object.entries(counts)) {
    for (let index = 0; index < count; index += 1) {
      const teamId = (index % 12) + 1;
      const projected = 2 + ((count - index) * 0.23) + (position === "MID" ? 0.7 : 0);
      players.push({
        id: id++, name: `${position}-${index}`, position, teamId,
        price: 4 + (index % 6) * 0.6 + (position === "FWD" ? 1 : 0),
        projected,
        selectionScore: projected,
        selectedBy: 10,
        chance: 100,
        status: "a",
      });
    }
  }
  return players;
}

test("deterministic optimiser returns a legal squad and legal XI", () => {
  const players = makePlayers();
  const squad = optimiseSquad(players, 100, { beamWidth: 1200 });
  assert.ok(squad);
  assert.equal(isLegalSquad(squad, 100), true);
  const { starters, bench } = pickStartingXI(squad);
  assert.equal(starters.length, 11);
  assert.equal(bench.length, 4);
  assert.equal(starters.filter((player) => player.position === "GK").length, 1);
  assert.ok(starters.filter((player) => player.position === "DEF").length >= 3);
  assert.ok(starters.filter((player) => player.position === "FWD").length >= 1);
});

test("transfer optimiser includes hit cost and keeps the team when a paid move is not worth four points", () => {
  const players = makePlayers();
  const current = optimiseSquad(players, 100, { beamWidth: 1200 });
  assert.ok(current);
  const reserve = players.find((player) =>
    player.position === current[0].position &&
    !current.some((selected) => selected.id === player.id)
  );
  reserve.selectionScore = current[0].selectionScore + 1;
  reserve.projected = reserve.selectionScore;
  reserve.price = current[0].price;
  reserve.teamId = current[0].teamId;
  const result = optimiseTransfers(current, players, 0, 0, 1);
  assert.ok(result);
  assert.equal(result.transfers, 0);
  assert.equal(result.hitCost, 0);
});

test("next future deadline is targeted after the active gameweek deadline has passed", () => {
  const events = [
    { id: 1, is_current: true, deadline_time: "2026-08-21T17:30:00Z" },
    { id: 2, is_next: true, deadline_time: "2026-08-28T17:30:00Z" },
  ];
  assert.equal(resolveTargetEvent(events, Date.parse("2026-08-24T08:00:00Z")), 2);
  assert.equal(resolveTargetEvent(events, Date.parse("2026-08-20T08:00:00Z")), 1);
});

test("starting XI avoids opposing defender-versus-attacker fixture clashes", () => {
  let id = 1;
  const make = (position, teamId, selectionScore, opponentId = null) => ({
    id: id++,
    name: `${position}-${id}`,
    position,
    teamId,
    price: 5,
    projected: selectionScore,
    selectionScore,
    breakdown: opponentId == null ? [] : [{ event: 2, opponentId }],
  });
  const squad = [
    make("GK", 3, 5), make("GK", 4, 1),
    make("DEF", 1, 10, 2), make("DEF", 5, 9), make("DEF", 6, 8), make("DEF", 7, 7), make("DEF", 8, 1),
    make("MID", 2, 10, 1), make("MID", 9, 9), make("MID", 10, 8), make("MID", 11, 7), make("MID", 12, 1),
    make("FWD", 13, 9), make("FWD", 14, 8), make("FWD", 15, 1),
  ];
  const { starters } = pickStartingXI(squad);
  assert.equal(starters.length, 11);
  assert.equal(fixtureClashes(starters, 2).length, 0);
  assert.equal(starters.some((player) => player.teamId === 1), false);
});
