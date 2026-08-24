export const POSITION_LIMITS = Object.freeze({ GK: 2, DEF: 5, MID: 5, FWD: 3 });
const LEGAL_FORMATIONS = [
  { GK: 1, DEF: 3, MID: 4, FWD: 3 },
  { GK: 1, DEF: 3, MID: 5, FWD: 2 },
  { GK: 1, DEF: 4, MID: 3, FWD: 3 },
  { GK: 1, DEF: 4, MID: 4, FWD: 2 },
  { GK: 1, DEF: 4, MID: 5, FWD: 1 },
  { GK: 1, DEF: 5, MID: 3, FWD: 2 },
  { GK: 1, DEF: 5, MID: 4, FWD: 1 },
];
const DEFENSIVE_POSITIONS = new Set(["GK", "DEF"]);
const ATTACKING_POSITIONS = new Set(["MID", "FWD"]);

const GOAL_POINTS = Object.freeze({ GK: 6, DEF: 6, MID: 5, FWD: 4 });
const CLEAN_SHEET_POINTS = Object.freeze({ GK: 4, DEF: 4, MID: 1, FWD: 0 });
const RATE_PRIORS = Object.freeze({
  GK: { xg: 0.002, xa: 0.008, bonus: 0.10, cards: 0.035 },
  DEF: { xg: 0.055, xa: 0.080, bonus: 0.20, cards: 0.075 },
  MID: { xg: 0.205, xa: 0.165, bonus: 0.28, cards: 0.070 },
  FWD: { xg: 0.360, xa: 0.135, bonus: 0.30, cards: 0.065 },
});

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const sum = (values) => values.reduce((total, value) => total + value, 0);

function weightedMean(values, fallback = 0) {
  const denominator = sum(values.map((item) => item.weight));
  return denominator ? sum(values.map((item) => item.value * item.weight)) / denominator : fallback;
}

function weightedRate(rows, predicate, prior, priorWeight = 3) {
  const hits = sum(rows.map((row) => row.weight * (predicate(row) ? 1 : 0)));
  const weight = sum(rows.map((row) => row.weight));
  return (hits + prior * priorWeight) / (weight + priorWeight);
}

function weightedStdDev(values, mean) {
  const denominator = sum(values.map((item) => item.weight));
  if (!denominator) return 2.5;
  const variance = sum(values.map((item) => item.weight * ((item.value - mean) ** 2))) / denominator;
  return Math.sqrt(Math.max(variance, 0));
}

function averageStrength(teams, field) {
  const values = teams.map((team) => number(team[field], 1000)).filter((value) => value > 0);
  return values.length ? sum(values) / values.length : 1000;
}

export function buildTeamModel(fixtures, teams, beforeEvent = Infinity) {
  const teamList = Array.from(teams.values ? teams.values() : teams);
  const finished = fixtures.filter((fixture) =>
    fixture.finished && fixture.event != null && fixture.event < beforeEvent &&
    fixture.team_h_score != null && fixture.team_a_score != null
  );
  const latestEvent = finished.reduce((latest, fixture) => Math.max(latest, number(fixture.event)), 0);
  const totals = new Map(teamList.map((team) => [team.id, {
    homeFor: 0, homeAgainst: 0, homeWeight: 0,
    awayFor: 0, awayAgainst: 0, awayWeight: 0,
  }]));
  let homeGoals = 0;
  let awayGoals = 0;
  let totalWeight = 0;

  for (const fixture of finished) {
    const weight = 0.88 ** Math.max(0, latestEvent - number(fixture.event));
    const home = totals.get(fixture.team_h);
    const away = totals.get(fixture.team_a);
    if (!home || !away) continue;
    const scoredHome = number(fixture.team_h_score);
    const scoredAway = number(fixture.team_a_score);
    home.homeFor += scoredHome * weight;
    home.homeAgainst += scoredAway * weight;
    home.homeWeight += weight;
    away.awayFor += scoredAway * weight;
    away.awayAgainst += scoredHome * weight;
    away.awayWeight += weight;
    homeGoals += scoredHome * weight;
    awayGoals += scoredAway * weight;
    totalWeight += weight;
  }

  const leagueHome = totalWeight ? homeGoals / totalWeight : 1.55;
  const leagueAway = totalWeight ? awayGoals / totalWeight : 1.25;
  const attackHomeMean = averageStrength(teamList, "strength_attack_home");
  const attackAwayMean = averageStrength(teamList, "strength_attack_away");
  const defenceHomeMean = averageStrength(teamList, "strength_defence_home");
  const defenceAwayMean = averageStrength(teamList, "strength_defence_away");
  const priorMatches = finished.length < 30 ? 6 : 4;
  const ratings = new Map();

  for (const team of teamList) {
    const observed = totals.get(team.id) || { homeFor: 0, homeAgainst: 0, homeWeight: 0, awayFor: 0, awayAgainst: 0, awayWeight: 0 };
    const priorAttackHome = clamp(number(team.strength_attack_home, attackHomeMean) / attackHomeMean, 0.70, 1.35);
    const priorAttackAway = clamp(number(team.strength_attack_away, attackAwayMean) / attackAwayMean, 0.70, 1.35);
    const priorConcedeHome = clamp(defenceHomeMean / number(team.strength_defence_home, defenceHomeMean), 0.70, 1.35);
    const priorConcedeAway = clamp(defenceAwayMean / number(team.strength_defence_away, defenceAwayMean), 0.70, 1.35);
    ratings.set(team.id, {
      attackHome: ((observed.homeFor + priorMatches * leagueHome * priorAttackHome) / (observed.homeWeight + priorMatches)) / leagueHome,
      attackAway: ((observed.awayFor + priorMatches * leagueAway * priorAttackAway) / (observed.awayWeight + priorMatches)) / leagueAway,
      concedeHome: ((observed.homeAgainst + priorMatches * leagueAway * priorConcedeHome) / (observed.homeWeight + priorMatches)) / leagueAway,
      concedeAway: ((observed.awayAgainst + priorMatches * leagueHome * priorConcedeAway) / (observed.awayWeight + priorMatches)) / leagueHome,
    });
  }

  return {
    leagueHome,
    leagueAway,
    ratings,
    expectedGoals(teamId, opponentId, isHome) {
      const team = ratings.get(teamId) || { attackHome: 1, attackAway: 1 };
      const opponent = ratings.get(opponentId) || { concedeHome: 1, concedeAway: 1 };
      const expected = isHome
        ? leagueHome * team.attackHome * opponent.concedeAway
        : leagueAway * team.attackAway * opponent.concedeHome;
      return clamp(expected, 0.25, 3.40);
    },
    neutralGoals(teamId) {
      const team = ratings.get(teamId) || { attackHome: 1, attackAway: 1 };
      return Math.max(0.35, (leagueHome * team.attackHome + leagueAway * team.attackAway) / 2);
    },
  };
}

function playerHistory(player, historyByPlayer, currentEvent) {
  const raw = historyByPlayer?.[String(player.id)] || historyByPlayer?.[player.id] || [];
  return raw
    .filter((row) => row.event < currentEvent)
    .sort((a, b) => b.event - a.event)
    .slice(0, 8)
    .map((row, index) => ({ ...row, weight: 0.78 ** index }));
}

function shrunkPer90(total, minutes, priorRate, priorMinutes = 540) {
  return ((number(total) + priorRate * priorMinutes / 90) / (Math.max(0, number(minutes)) + priorMinutes)) * 90;
}

function estimateMinutes(player, history, teamMatches) {
  const seasonAppearanceRate = teamMatches > 0 ? clamp(number(player.appearances) / teamMatches, 0, 1) : 0.65;
  const seasonStartRate = teamMatches > 0 ? clamp(number(player.starts) / teamMatches, 0, 1) : 0.55;
  const recentMinutes = weightedMean(history.map((row) => ({ value: number(row.minutes), weight: row.weight })), number(player.minutes) / Math.max(teamMatches, 1));
  const seasonMinutes = clamp(number(player.minutes) / Math.max(teamMatches, 1), 0, 90);
  const expected = clamp(0.55 * recentMinutes + 0.30 * seasonMinutes + 0.15 * (seasonStartRate * 75 + (1 - seasonStartRate) * 18), 0, 90);
  const availability = player.status === "u" ? 0 : clamp(number(player.chance, 100) / 100, 0, 1);
  const appearance = availability * weightedRate(history, (row) => number(row.minutes) > 0, seasonAppearanceRate, 3);
  const sixty = availability * weightedRate(history, (row) => number(row.minutes) >= 60, seasonStartRate, 3);
  return {
    expected: expected * availability,
    appearance: clamp(appearance, 0, 1),
    sixty: clamp(sixty, 0, 1),
    reliability: clamp(0.55 * sixty + 0.45 * availability, 0, 1),
  };
}

function strategyScore(projected, uncertainty, reliability, selectedBy, risk) {
  if (risk === "safe") return projected - 0.20 * uncertainty + 0.22 * reliability;
  if (risk === "differential") return projected + 0.08 * uncertainty + clamp((10 - number(selectedBy)) * 0.025, 0, 0.25);
  return projected;
}

function applyPredictionCalibration(row, model) {
  if (!model?.calibrations || row.expectedMinutes < 30) return row.predicted;
  const minuteBand = Math.floor(row.expectedMinutes / 15);
  const calibration = model.calibrations[`${row.position}|${minuteBand}`] ||
    model.calibrations[row.position] || model.calibrations.ALL;
  if (!calibration) return row.predicted;
  const base = Math.max(0, number(calibration.scale, 1) * (
    number(calibration.blend, 1) * row.predicted +
    (1 - number(calibration.blend, 1)) * row.baseline
  ) + number(calibration.offset));
  const predictionBand = Math.floor(row.predicted);
  const keys = [
    `${row.position}|${minuteBand}|${predictionBand}`,
    `${row.position}|*|${predictionBand}`,
    `${row.position}|${minuteBand}|*`,
  ];
  const match = keys.map((key) => model.residuals?.[key]).find((group) => number(group?.count) >= 20);
  if (!match) return base;
  const weight = 0.72 * number(match.count) / (number(match.count) + 35);
  return Math.max(0, base + weight * number(match.residual));
}

export function projectPlayer(player, context, horizon = 3, risk = "balanced") {
  const currentEvent = number(context.currentEvent, 1);
  const fixtures = context.fixtures
    .filter((fixture) =>
      !fixture.finished && fixture.event != null && fixture.event >= currentEvent &&
      fixture.event < currentEvent + Number(horizon) &&
      (fixture.team_h === player.teamId || fixture.team_a === player.teamId)
    )
    .sort((a, b) => a.event - b.event);
  const history = playerHistory(player, context.historyByPlayer, currentEvent);
  const teamMatches = context.fixtures.filter((fixture) =>
    fixture.finished && (fixture.team_h === player.teamId || fixture.team_a === player.teamId) && fixture.event < currentEvent
  ).length;
  const minuteModel = estimateMinutes(player, history, teamMatches);
  const priors = RATE_PRIORS[player.position] || RATE_PRIORS.MID;
  const xg90 = shrunkPer90(player.expectedGoals, player.minutes, priors.xg);
  const xa90 = shrunkPer90(player.expectedAssists, player.minutes, priors.xa);
  const bonus90 = shrunkPer90(player.bonus, player.minutes, priors.bonus, 720);
  const card90 = shrunkPer90(number(player.yellowCards) + 3 * number(player.redCards), player.minutes, priors.cards, 720);
  const saves90 = player.position === "GK" ? shrunkPer90(player.saves, player.minutes, 2.8, 540) : 0;
  const recentXgi90 = weightedMean(history
    .filter((row) => number(row.minutes) > 0)
    .map((row) => ({ value: (number(row.expected_goals) + number(row.expected_assists)) * 90 / Math.max(15, number(row.minutes)), weight: row.weight })), xg90 + xa90);
  const formMultiplier = clamp((recentXgi90 + 0.20) / (xg90 + xa90 + 0.20), 0.82, 1.20);
  const recentPoints = history.map((row) => ({ value: number(row.total_points), weight: row.weight }));
  const recentMean = weightedMean(recentPoints, number(player.pointsPerGame, 2.5));
  const recentSpread = clamp(weightedStdDev(recentPoints, recentMean), 1.5, 7.5);
  let projected = 0;
  const breakdown = [];

  for (const fixture of fixtures) {
    const isHome = fixture.team_h === player.teamId;
    const opponentId = isHome ? fixture.team_a : fixture.team_h;
    const teamGoals = context.teamModel.expectedGoals(player.teamId, opponentId, isHome);
    const opponentGoals = context.teamModel.expectedGoals(opponentId, player.teamId, !isHome);
    const attackScale = clamp(teamGoals / context.teamModel.neutralGoals(player.teamId), 0.68, 1.48);
    const minutesShare = minuteModel.expected / 90;
    const expectedGoals = xg90 * formMultiplier * minutesShare * attackScale;
    const expectedAssists = xa90 * formMultiplier * minutesShare * attackScale;
    const appearancePoints = minuteModel.appearance + minuteModel.sixty;
    const attackingPoints = expectedGoals * GOAL_POINTS[player.position] + expectedAssists * 3;
    const cleanSheetProbability = Math.exp(-opponentGoals) * minuteModel.sixty;
    const cleanSheetPoints = cleanSheetProbability * CLEAN_SHEET_POINTS[player.position];
    const savePoints = player.position === "GK" ? (saves90 * minutesShare) / 3 : 0;
    const concededPenalty = ["GK", "DEF"].includes(player.position) ? -(opponentGoals / 2) * minuteModel.sixty : 0;
    const bonusPoints = bonus90 * minutesShare * clamp((teamGoals + 0.5) / 1.9, 0.72, 1.25);
    const discipline = -card90 * minutesShare;
    const eventWeight = 0.97 ** Math.max(0, fixture.event - currentEvent);
    const points = Math.max(0, appearancePoints + attackingPoints + cleanSheetPoints + savePoints + concededPenalty + bonusPoints + discipline) * eventWeight;
    projected += points;
    breakdown.push({
      event: fixture.event,
      opponentId,
      isHome,
      teamGoals,
      opponentGoals,
      expectedMinutes: minuteModel.expected,
      points,
    });
  }

  const structuralProjected = projected;
  if (fixtures.length && context.predictionCalibration) {
    const baseline = history.length
      ? sum(history.map((row) => number(row.total_points))) / history.length
      : number(player.pointsPerGame, 2.5);
    projected = applyPredictionCalibration({
      position: player.position,
      predicted: structuralProjected / fixtures.length,
      baseline,
      expectedMinutes: minuteModel.expected,
    }, context.predictionCalibration) * fixtures.length;
  }
  const uncertainty = recentSpread * Math.sqrt(Math.max(fixtures.length, 1)) * (1.08 - 0.38 * minuteModel.reliability);
  if (!fixtures.length) projected = 0;
  projected = Number(projected.toFixed(2));
  return {
    ...player,
    projected,
    structuralProjected: Number(structuralProjected.toFixed(2)),
    selectionScore: Number(strategyScore(projected, uncertainty, minuteModel.reliability, player.selectedBy, risk).toFixed(3)),
    floor: Number(Math.max(0, projected - uncertainty).toFixed(1)),
    ceiling: Number((projected + uncertainty).toFixed(1)),
    uncertainty: Number(uncertainty.toFixed(2)),
    expectedMinutes: Number(minuteModel.expected.toFixed(1)),
    appearanceProbability: Number(minuteModel.appearance.toFixed(3)),
    reliability: Number(minuteModel.reliability.toFixed(3)),
    breakdown,
  };
}

export function projectPlayers(players, context, horizon = 3, risk = "balanced") {
  const teams = context.teams instanceof Map ? context.teams : new Map(context.teams.map((team) => [team.id, team]));
  const teamModel = context.teamModel || buildTeamModel(context.fixtures, teams, context.currentEvent);
  const modelContext = { ...context, teams, teamModel };
  return players.map((player) => projectPlayer(player, modelContext, horizon, risk));
}

export function resolveTargetEvent(events, now = Date.now()) {
  const available = Array.isArray(events) ? events : [];
  const future = available
    .filter((event) => {
      const deadline = new Date(event.deadline_time).getTime();
      return Number.isFinite(deadline) && deadline > Number(now);
    })
    .sort((left, right) => new Date(left.deadline_time) - new Date(right.deadline_time));
  return future[0]?.id || available.find((event) => event.is_next)?.id ||
    available.find((event) => event.is_current)?.id || null;
}

function combinations(items, size) {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const output = [];
  for (let index = 0; index <= items.length - size; index += 1) {
    for (const tail of combinations(items.slice(index + 1), size - 1)) {
      output.push([items[index], ...tail]);
    }
  }
  return output;
}

function firstProjectedEvent(players) {
  const events = players.flatMap((player) => (player.breakdown || [])
    .map((fixture) => number(fixture.event, Infinity))
    .filter(Number.isFinite));
  return events.length ? Math.min(...events) : null;
}

function shareOpposingFixture(left, right, event) {
  if (event == null) return false;
  const leftFacesRight = (left.breakdown || []).some((fixture) =>
    number(fixture.event) === event && number(fixture.opponentId) === number(right.teamId)
  );
  const rightFacesLeft = (right.breakdown || []).some((fixture) =>
    number(fixture.event) === event && number(fixture.opponentId) === number(left.teamId)
  );
  return leftFacesRight && rightFacesLeft;
}

export function fixtureClashes(players, event = firstProjectedEvent(players)) {
  const clashes = [];
  for (let leftIndex = 0; leftIndex < players.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < players.length; rightIndex += 1) {
      const left = players[leftIndex];
      const right = players[rightIndex];
      const opposingRoles = (
        DEFENSIVE_POSITIONS.has(left.position) && ATTACKING_POSITIONS.has(right.position)
      ) || (
        ATTACKING_POSITIONS.has(left.position) && DEFENSIVE_POSITIONS.has(right.position)
      );
      if (opposingRoles && shareOpposingFixture(left, right, event)) {
        clashes.push({ left, right, event });
      }
    }
  }
  return clashes;
}

function pickStartingXIFast(squad, scoreField = "selectionScore") {
  const byPosition = squad.reduce((groups, player) => {
    (groups[player.position] ||= []).push(player);
    return groups;
  }, {});
  for (const position of Object.keys(POSITION_LIMITS)) byPosition[position] ||= [];
  for (const group of Object.values(byPosition)) {
    group.sort((left, right) => number(right[scoreField], right.projected) - number(left[scoreField], left.projected));
  }
  const starters = [byPosition.GK[0], ...byPosition.DEF.slice(0, 3), ...byPosition.MID.slice(0, 2), ...byPosition.FWD.slice(0, 1)];
  const starterIds = new Set(starters.map((player) => player.id));
  starters.push(...squad
    .filter((player) => !starterIds.has(player.id) && player.position !== "GK")
    .sort((left, right) => number(right[scoreField], right.projected) - number(left[scoreField], left.projected))
    .slice(0, 11 - starters.length));
  const finalStarterIds = new Set(starters.map((player) => player.id));
  const outfieldBench = squad
    .filter((player) => !finalStarterIds.has(player.id) && player.position !== "GK")
    .sort((left, right) => number(right[scoreField], right.projected) - number(left[scoreField], left.projected));
  const reserveKeeper = squad.find((player) => !finalStarterIds.has(player.id) && player.position === "GK");
  return { starters, bench: reserveKeeper ? [...outfieldBench, reserveKeeper] : outfieldBench };
}

export function pickStartingXI(squad, scoreField = "selectionScore") {
  const byPosition = squad.reduce((groups, player) => {
    (groups[player.position] ||= []).push(player);
    return groups;
  }, {});
  for (const position of Object.keys(POSITION_LIMITS)) byPosition[position] ||= [];
  let best = null;
  for (const formation of LEGAL_FORMATIONS) {
    const groups = Object.entries(formation).map(([position, count]) => combinations(byPosition[position], count));
    for (const keepers of groups[0]) {
      for (const defenders of groups[1]) {
        for (const midfielders of groups[2]) {
          for (const forwards of groups[3]) {
            const candidate = [...keepers, ...defenders, ...midfielders, ...forwards];
            const clashes = fixtureClashes(candidate).length;
            const score = sum(candidate.map((player) => number(player[scoreField], player.projected)));
            if (!best || clashes < best.clashes || (clashes === best.clashes && score > best.score)) {
              best = { starters: candidate, clashes, score };
            }
          }
        }
      }
    }
  }
  const starters = best?.starters || [];
  const finalStarterIds = new Set(starters.map((player) => player.id));
  const outfieldBench = squad
    .filter((player) => !finalStarterIds.has(player.id) && player.position !== "GK")
    .sort((a, b) => number(b[scoreField], b.projected) - number(a[scoreField], a.projected));
  const reserveKeeper = squad.find((player) => !finalStarterIds.has(player.id) && player.position === "GK");
  return { starters, bench: reserveKeeper ? [...outfieldBench, reserveKeeper] : outfieldBench };
}

export function squadObjective(squad) {
  if (!isLegalSquad(squad, Infinity)) return -Infinity;
  const { starters, bench } = pickStartingXIFast(squad);
  const captain = [...starters].sort((a, b) => b.selectionScore - a.selectionScore)[0];
  const outfieldBench = bench.filter((player) => player.position !== "GK");
  const keeper = bench.find((player) => player.position === "GK");
  const benchWeights = [0.16, 0.09, 0.05];
  const clashPenalty = fixtureClashes(starters).length * 25;
  return sum(starters.map((player) => player.selectionScore)) + captain.selectionScore +
    sum(outfieldBench.map((player, index) => player.selectionScore * (benchWeights[index] || 0.03))) +
    number(keeper?.selectionScore) * 0.035 - clashPenalty;
}

export function isLegalSquad(squad, budget) {
  if (!Array.isArray(squad) || squad.length !== 15) return false;
  if (new Set(squad.map((player) => player.id)).size !== 15) return false;
  if (sum(squad.map((player) => number(player.price))) > budget + 1e-6) return false;
  for (const [position, required] of Object.entries(POSITION_LIMITS)) {
    if (squad.filter((player) => player.position === position).length !== required) return false;
  }
  const clubs = squad.reduce((counts, player) => counts.set(player.teamId, (counts.get(player.teamId) || 0) + 1), new Map());
  return [...clubs.values()].every((count) => count <= 3);
}

function candidatePool(players, currentIds = []) {
  const retained = new Set(currentIds);
  const output = [];
  for (const position of Object.keys(POSITION_LIMITS)) {
    const group = players.filter((player) => player.position === position && player.status !== "u" && player.chance >= 25);
    const selected = [
      ...[...group].sort((a, b) => b.selectionScore - a.selectionScore).slice(0, 22),
      ...[...group].sort((a, b) => (b.selectionScore / Math.max(b.price, 3.5)) - (a.selectionScore / Math.max(a.price, 3.5))).slice(0, 8),
      ...[...group].sort((a, b) => a.price - b.price || b.selectionScore - a.selectionScore).slice(0, 6),
      ...group.filter((player) => retained.has(player.id)),
    ];
    const seen = new Set();
    output.push(...selected.filter((player) => !seen.has(player.id) && seen.add(player.id)));
  }
  return output;
}

function remainingMinimumCost(poolByPosition, positionIndex, slotInPosition, positions) {
  let cost = 0;
  for (let index = positionIndex; index < positions.length; index += 1) {
    const position = positions[index];
    const needed = POSITION_LIMITS[position] - (index === positionIndex ? slotInPosition : 0);
    const prices = poolByPosition[position].map((player) => player.price).sort((a, b) => a - b);
    cost += sum(prices.slice(0, Math.max(0, needed)));
  }
  return cost;
}

function trimBeam(states, width) {
  states.sort((a, b) => (b.proxy - 0.012 * b.cost) - (a.proxy - 0.012 * a.cost));
  return states.slice(0, width);
}

function improveSquad(squad, pool, budget) {
  let current = [...squad];
  let currentScore = squadObjective(current);
  for (let iteration = 0; iteration < 12; iteration += 1) {
    let best = null;
    for (const outgoing of current) {
      for (const incoming of pool) {
        if (incoming.position !== outgoing.position || current.some((player) => player.id === incoming.id)) continue;
        const candidate = current.map((player) => player.id === outgoing.id ? incoming : player);
        if (!isLegalSquad(candidate, budget)) continue;
        const score = squadObjective(candidate);
        if (score > currentScore + 1e-7 && (!best || score > best.score)) best = { candidate, score };
      }
    }
    if (!best) break;
    current = best.candidate;
    currentScore = best.score;
  }
  return current;
}

export function optimiseSquad(players, budget, options = {}) {
  const positions = Object.keys(POSITION_LIMITS);
  const pool = candidatePool(players, options.currentIds || []);
  const poolByPosition = Object.fromEntries(positions.map((position) => [position, pool
    .filter((player) => player.position === position)
    .sort((a, b) => b.selectionScore - a.selectionScore)]));
  const beamWidth = options.beamWidth || 1800;
  let states = [{ players: [], cost: 0, clubCounts: new Map(), proxy: 0 }];

  for (let positionIndex = 0; positionIndex < positions.length; positionIndex += 1) {
    const position = positions[positionIndex];
    const candidates = poolByPosition[position];
    for (let slot = 0; slot < POSITION_LIMITS[position]; slot += 1) {
      const next = [];
      for (const partial of states) {
        const startIndex = partial.nextIndex || 0;
        for (let index = startIndex; index < candidates.length; index += 1) {
          const player = candidates[index];
          if ((partial.clubCounts.get(player.teamId) || 0) >= 3) continue;
          const cost = partial.cost + player.price;
          const minimum = remainingMinimumCost(poolByPosition, positionIndex, slot + 1, positions);
          if (cost + minimum > budget + 1e-6) continue;
          const clubCounts = new Map(partial.clubCounts);
          clubCounts.set(player.teamId, (clubCounts.get(player.teamId) || 0) + 1);
          next.push({
            players: [...partial.players, player],
            cost,
            clubCounts,
            proxy: partial.proxy + player.selectionScore,
            nextIndex: index + 1,
          });
        }
      }
      states = trimBeam(next, beamWidth);
      if (!states.length) return null;
    }
    states = states.map(({ nextIndex, ...partial }) => partial);
  }

  const finalists = states.filter((partial) => isLegalSquad(partial.players, budget));
  finalists.sort((a, b) => squadObjective(b.players) - squadObjective(a.players));
  if (!finalists.length) return null;
  return improveSquad(finalists[0].players, pool, budget);
}

export function optimiseTransfers(currentSquad, players, bank = 0, freeTransfers = 1, maxTransfers = 3) {
  if (!isLegalSquad(currentSquad, Infinity)) return null;
  const originalIds = new Set(currentSquad.map((player) => player.id));
  const budget = sum(currentSquad.map((player) => player.price)) + Math.max(0, bank);
  const pool = candidatePool(players, [...originalIds]);
  const evaluate = (squad) => {
    const transfers = squad.filter((player) => !originalIds.has(player.id)).length;
    const hitCost = Math.max(0, transfers - freeTransfers) * 4;
    return { score: squadObjective(squad) - hitCost, transfers, hitCost };
  };
  let states = [{ squad: currentSquad, ...evaluate(currentSquad) }];
  let best = states[0];
  const seen = new Set([currentSquad.map((player) => player.id).sort((a, b) => a - b).join("-")]);

  for (let depth = 1; depth <= maxTransfers; depth += 1) {
    const next = [];
    for (const state of states) {
      for (const outgoing of state.squad) {
        for (const incoming of pool) {
          if (incoming.position !== outgoing.position || state.squad.some((player) => player.id === incoming.id)) continue;
          const squad = state.squad.map((player) => player.id === outgoing.id ? incoming : player);
          if (!isLegalSquad(squad, budget)) continue;
          const key = squad.map((player) => player.id).sort((a, b) => a - b).join("-");
          if (seen.has(key)) continue;
          seen.add(key);
          const evaluated = { squad, ...evaluate(squad) };
          if (evaluated.transfers !== depth) continue;
          next.push(evaluated);
          if (evaluated.score > best.score) best = evaluated;
        }
      }
    }
    next.sort((a, b) => b.score - a.score);
    states = next.slice(0, 900);
    if (!states.length) break;
  }
  return { ...best, budget };
}
