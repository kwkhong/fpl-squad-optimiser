import { readFile, writeFile } from "node:fs/promises";
import { buildTeamModel, projectPlayers } from "../engine.mjs";

const snapshot = JSON.parse(await readFile("data/fpl.json", "utf8"));
const teams = new Map(snapshot.bootstrap.teams.map((team) => [team.id, team]));
const position = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" };
const historyEvents = snapshot.historyEvents || [];
const targets = historyEvents.filter((event) => historyEvents.filter((prior) => prior < event).length >= 3).slice(-5);

function aggregatePlayer(element, rows) {
  const total = (field) => rows.reduce((value, row) => value + Number(row[field] || 0), 0);
  const appearances = rows.filter((row) => Number(row.minutes) > 0).length;
  return {
    id: element.id,
    name: element.web_name,
    teamId: element.team,
    team: teams.get(element.team)?.short_name || "TBC",
    position: position[element.element_type],
    price: Number(element.now_cost || 40) / 10,
    selectedBy: Number(element.selected_by_percent || 0),
    expectedGoals: total("expected_goals"),
    expectedAssists: total("expected_assists"),
    bonus: total("bonus"),
    bps: total("bps"),
    saves: total("saves"),
    yellowCards: total("yellow_cards"),
    redCards: total("red_cards"),
    starts: rows.filter((row) => Number(row.starts) > 0 || Number(row.minutes) >= 60).length,
    appearances,
    minutes: total("minutes"),
    pointsPerGame: appearances ? total("total_points") / appearances : 0,
    chance: 100,
    status: "a",
  };
}

function ranks(values) {
  const ordered = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const output = Array(values.length);
  for (let start = 0; start < ordered.length;) {
    let end = start + 1;
    while (end < ordered.length && ordered[end].value === ordered[start].value) end += 1;
    const rank = (start + end - 1) / 2 + 1;
    for (let index = start; index < end; index += 1) output[ordered[index].index] = rank;
    start = end;
  }
  return output;
}

function correlation(left, right) {
  if (left.length < 2 || left.length !== right.length) return null;
  const meanLeft = left.reduce((a, b) => a + b, 0) / left.length;
  const meanRight = right.reduce((a, b) => a + b, 0) / right.length;
  let covariance = 0;
  let varianceLeft = 0;
  let varianceRight = 0;
  for (let index = 0; index < left.length; index += 1) {
    const x = left[index] - meanLeft;
    const y = right[index] - meanRight;
    covariance += x * y;
    varianceLeft += x * x;
    varianceRight += y * y;
  }
  return varianceLeft && varianceRight ? covariance / Math.sqrt(varianceLeft * varianceRight) : null;
}

const observations = [];
for (const targetEvent of targets) {
  const priorHistory = {};
  for (const [id, rows] of Object.entries(snapshot.historyByPlayer || {})) {
    priorHistory[id] = rows.filter((row) => row.event < targetEvent);
  }
  const pastFixtures = snapshot.fixtures.filter((fixture) => fixture.finished && fixture.event < targetEvent);
  const projectionFixtures = snapshot.fixtures.map((fixture) =>
    fixture.event === targetEvent ? { ...fixture, finished: false } : fixture
  );
  const teamModel = buildTeamModel(pastFixtures, teams, targetEvent);
  const players = snapshot.bootstrap.elements.map((element) => aggregatePlayer(element, priorHistory[element.id] || []));
  const forecasts = projectPlayers(players, {
    fixtures: projectionFixtures,
    teams,
    currentEvent: targetEvent,
    historyByPlayer: priorHistory,
    teamModel,
  }, 1, "balanced");
  const actualById = new Map(Object.entries(snapshot.historyByPlayer || {}).map(([id, rows]) => [
    Number(id),
    rows.find((row) => row.event === targetEvent),
  ]));
  for (const forecast of forecasts) {
    const actual = actualById.get(forecast.id);
    const priorRows = priorHistory[forecast.id] || [];
    if (!actual || !priorRows.length || forecast.expectedMinutes < 30) continue;
    const baseline = priorRows.reduce((total, row) => total + Number(row.total_points || 0), 0) / priorRows.length;
    observations.push({
      event: targetEvent,
      predicted: forecast.projected,
      actual: Number(actual.total_points || 0),
      baseline,
    });
  }
}

const mae = (field) => observations.length
  ? observations.reduce((total, row) => total + Math.abs(row[field] - row.actual), 0) / observations.length
  : null;
const rmse = observations.length
  ? Math.sqrt(observations.reduce((total, row) => total + ((row.predicted - row.actual) ** 2), 0) / observations.length)
  : null;
const predictedRanks = ranks(observations.map((row) => row.predicted));
const actualRanks = ranks(observations.map((row) => row.actual));
const baselineRanks = ranks(observations.map((row) => row.baseline));
const metrics = {
  generatedAt: new Date().toISOString(),
  method: "Rolling-origin backtest with no future gameweek player statistics",
  population: "Players forecast for at least 30 minutes per fixture",
  events: targets,
  observations: observations.length,
  mae: mae("predicted"),
  rmse,
  baselineMae: mae("baseline"),
  rankCorrelation: correlation(predictedRanks, actualRanks),
  baselineRankCorrelation: correlation(baselineRanks, actualRanks),
};

snapshot.modelMetrics = metrics;
await writeFile("data/fpl.json", JSON.stringify(snapshot));
console.log(JSON.stringify(metrics, null, 2));
