import { readFile, writeFile } from "node:fs/promises";
import { buildTeamModel, projectPlayers } from "../engine.mjs";

const ROOT = "https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data/2024-25";
const snapshot = JSON.parse(await readFile("data/fpl.json", "utf8"));
if (snapshot.modelMetrics?.observations > 0) {
  console.log("Current-season rolling backtest is available; historical fallback not required.");
  process.exit(0);
}

async function getText(path) {
  const response = await fetch(`${ROOT}/${path}`, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.text();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field); field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field); field = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const headers = rows.shift();
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

const [gameweekText, fixtureText, teamText] = await Promise.all([
  getText("gws/merged_gw.csv"),
  getText("fixtures.csv"),
  getText("teams.csv"),
]);
const gameweeks = parseCsv(gameweekText);
const rawFixtures = parseCsv(fixtureText);
const rawTeams = parseCsv(teamText);
const teams = new Map(rawTeams.map((team) => [Number(team.id), {
  id: Number(team.id),
  name: team.name,
  short_name: team.short_name,
  strength_attack_home: Number(team.strength_attack_home),
  strength_attack_away: Number(team.strength_attack_away),
  strength_defence_home: Number(team.strength_defence_home),
  strength_defence_away: Number(team.strength_defence_away),
}]));
const fixtures = rawFixtures.map((fixture) => ({
  id: Number(fixture.id),
  event: Number(fixture.event),
  finished: fixture.finished === "True",
  team_h: Number(fixture.team_h),
  team_a: Number(fixture.team_a),
  team_h_score: fixture.team_h_score === "" ? null : Number(fixture.team_h_score),
  team_a_score: fixture.team_a_score === "" ? null : Number(fixture.team_a_score),
}));
const fixtureById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
const rowsByElement = new Map();
for (const row of gameweeks) {
  const element = Number(row.element);
  const event = Number(row.GW || row.round);
  if (!element || !event) continue;
  (rowsByElement.get(element) || rowsByElement.set(element, []).get(element)).push({ ...row, event });
}
for (const rows of rowsByElement.values()) rows.sort((a, b) => a.event - b.event);

const positionMap = {
  GK: "GK", GKP: "GK", Goalkeeper: "GK",
  DEF: "DEF", Defender: "DEF",
  MID: "MID", Midfielder: "MID",
  FWD: "FWD", Forward: "FWD",
};
const numeric = (row, field) => Number(row[field] || 0);
const total = (rows, field) => rows.reduce((value, row) => value + numeric(row, field), 0);

function historicalPlayer(element, targetRows, priorRows) {
  const anchor = targetRows[0];
  const fixture = fixtureById.get(Number(anchor.fixture));
  const isHome = String(anchor.was_home).toLowerCase() === "true";
  const teamId = fixture ? (isHome ? fixture.team_h : fixture.team_a) : Number(anchor.team);
  const appearances = priorRows.filter((row) => numeric(row, "minutes") > 0).length;
  return {
    id: element,
    name: anchor.name,
    teamId,
    team: teams.get(teamId)?.short_name || anchor.team,
    position: positionMap[anchor.position] || anchor.position,
    price: numeric(anchor, "value") / 10,
    selectedBy: 0,
    expectedGoals: total(priorRows, "expected_goals"),
    expectedAssists: total(priorRows, "expected_assists"),
    bonus: total(priorRows, "bonus"),
    bps: total(priorRows, "bps"),
    saves: total(priorRows, "saves"),
    yellowCards: total(priorRows, "yellow_cards"),
    redCards: total(priorRows, "red_cards"),
    starts: total(priorRows, "starts"),
    appearances,
    minutes: total(priorRows, "minutes"),
    pointsPerGame: appearances ? total(priorRows, "total_points") / appearances : 0,
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
  const leftMean = left.reduce((a, b) => a + b, 0) / left.length;
  const rightMean = right.reduce((a, b) => a + b, 0) / right.length;
  let covariance = 0, leftVariance = 0, rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const x = left[index] - leftMean;
    const y = right[index] - rightMean;
    covariance += x * y;
    leftVariance += x * x;
    rightVariance += y * y;
  }
  return leftVariance && rightVariance ? covariance / Math.sqrt(leftVariance * rightVariance) : null;
}

const observations = [];
for (let targetEvent = 4; targetEvent <= 38; targetEvent += 1) {
  const historyByPlayer = {};
  const players = [];
  const actual = new Map();
  for (const [element, rows] of rowsByElement) {
    const priorRows = rows.filter((row) => row.event < targetEvent).slice(-8);
    const targetRows = rows.filter((row) => row.event === targetEvent);
    if (priorRows.length < 3 || !targetRows.length) continue;
    const player = historicalPlayer(element, targetRows, priorRows);
    if (!["GK", "DEF", "MID", "FWD"].includes(player.position) || !player.teamId) continue;
    players.push(player);
    historyByPlayer[element] = priorRows.map((row) => ({
      event: row.event,
      minutes: numeric(row, "minutes"),
      total_points: numeric(row, "total_points"),
      expected_goals: numeric(row, "expected_goals"),
      expected_assists: numeric(row, "expected_assists"),
    }));
    actual.set(element, total(targetRows, "total_points"));
  }
  const pastFixtures = fixtures.filter((fixture) => fixture.finished && fixture.event < targetEvent);
  const targetFixtures = fixtures.map((fixture) =>
    fixture.event === targetEvent ? { ...fixture, finished: false } : fixture
  );
  const teamModel = buildTeamModel(pastFixtures, teams, targetEvent);
  const forecasts = projectPlayers(players, {
    fixtures: targetFixtures,
    teams,
    currentEvent: targetEvent,
    historyByPlayer,
    teamModel,
  }, 1, "balanced");
  for (const forecast of forecasts) {
    if (forecast.expectedMinutes < 30) continue;
    const priorRows = historyByPlayer[forecast.id];
    const baseline = priorRows.reduce((value, row) => value + row.total_points, 0) / priorRows.length;
    observations.push({
      event: targetEvent,
      predicted: forecast.projected,
      baseline,
      actual: actual.get(forecast.id),
    });
  }
}

const mae = (field) => observations.reduce((value, row) => value + Math.abs(row[field] - row.actual), 0) / observations.length;
const rmse = Math.sqrt(observations.reduce((value, row) => value + ((row.predicted - row.actual) ** 2), 0) / observations.length);
const actualRanks = ranks(observations.map((row) => row.actual));
const metrics = {
  generatedAt: new Date().toISOString(),
  source: "Vaastav Anand FPL Historical Dataset (2024-25), derived from official FPL data",
  sourceUrl: "https://github.com/vaastav/Fantasy-Premier-League",
  method: "Rolling-origin backtest; each GW uses at most the preceding eight GWs",
  population: "Players forecast for at least 30 minutes per fixture",
  season: "2024-25",
  events: [4, 38],
  observations: observations.length,
  mae: mae("predicted"),
  rmse,
  baselineMae: mae("baseline"),
  rankCorrelation: correlation(ranks(observations.map((row) => row.predicted)), actualRanks),
  baselineRankCorrelation: correlation(ranks(observations.map((row) => row.baseline)), actualRanks),
};

snapshot.historicalModelMetrics = metrics;
if (!snapshot.modelMetrics?.observations) snapshot.modelMetrics = metrics;
await writeFile("data/fpl.json", JSON.stringify(snapshot));
console.log(JSON.stringify(metrics, null, 2));
