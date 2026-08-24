import {
  fixtureClashes,
  optimiseSquad,
  optimiseTransfers,
  pickStartingXI,
  projectPlayers,
  resolveTargetEvent,
} from "./engine.mjs?v=20260824-1";

const FPL_API = "https://fantasy.premierleague.com/api";
const FPL_TEAM_API = "https://fpl-squad-optimiser.vercel.app/api/fpl-team";
const FPL_SQUAD_URL = "https://fantasy.premierleague.com/en/squad-selection";

const POSITION = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" };
const SHIRT_COLOURS = ["#ef3340", "#79c9f5", "#f7d652", "#ffffff", "#9f7aea", "#ff8c42", "#58b368", "#f2a7c6"];

const state = {
  mode: "new",
  players: [],
  teams: new Map(),
  currentEvent: null,
  fixtures: [],
  historyByPlayer: {},
  predictionCalibration: null,
  modelMetrics: null,
  live: false,
  importedIds: [],
  bank: 0,
  transferPlan: null,
  recommendation: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const money = (value) => `£${Number(value).toFixed(1)}m`;

function seededNoise(id, seed) {
  const x = Math.sin(id * 12.9898 + seed * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function teamColour(teamId) {
  return SHIRT_COLOURS[(Number(teamId) - 1) % SHIRT_COLOURS.length];
}

function normalisePlayer(player) {
  const team = state.teams.get(player.team) || { name: `Club ${player.team}`, short_name: "CLB" };
  return {
    id: player.id,
    name: player.web_name || player.name,
    teamId: player.team,
    team: team.short_name || team.name,
    teamStrength: {
      attackHome: Number(team.strength_attack_home || 1000),
      attackAway: Number(team.strength_attack_away || 1000),
      defenceHome: Number(team.strength_defence_home || 1000),
      defenceAway: Number(team.strength_defence_away || 1000),
    },
    position: POSITION[player.element_type] || player.position,
    price: player.now_cost ? player.now_cost / 10 : Number(player.price),
    form: Number(player.form || 0),
    pointsPerGame: Number(player.points_per_game || 0),
    totalPoints: Number(player.total_points || 0),
    selectedBy: Number(player.selected_by_percent || 0),
    ict: Number(player.ict_index || 0),
    xgi: Number(player.expected_goal_involvements || 0),
    expectedGoals: Number(player.expected_goals || 0),
    expectedAssists: Number(player.expected_assists || 0),
    goals: Number(player.goals_scored || 0),
    assists: Number(player.assists || 0),
    cleanSheets: Number(player.clean_sheets || 0),
    bonus: Number(player.bonus || 0),
    bps: Number(player.bps || 0),
    saves: Number(player.saves || 0),
    yellowCards: Number(player.yellow_cards || 0),
    redCards: Number(player.red_cards || 0),
    starts: Number(player.starts || 0),
    appearances: Number(player.starts || 0) + Number(player.subbed_in || 0),
    minutes: Number(player.minutes || 0),
    chance: player.chance_of_playing_next_round == null ? 100 : Number(player.chance_of_playing_next_round),
    status: player.status || "a",
    news: player.news || "",
  };
}

function upcomingFixtures(player, horizon) {
  return state.fixtures
    .filter((fixture) =>
      !fixture.finished &&
      fixture.event != null &&
      fixture.event >= state.currentEvent &&
      fixture.event < state.currentEvent + Number(horizon) &&
      (fixture.team_h === player.teamId || fixture.team_a === player.teamId)
    )
    .sort((a, b) => a.event - b.event);
}

function fixtureLabel(player, fixture) {
  const isHome = fixture.team_h === player.teamId;
  const opponentId = isHome ? fixture.team_a : fixture.team_h;
  const opponent = state.teams.get(opponentId);
  return `${opponent?.short_name || "TBC"} (${isHome ? "H" : "A"})`;
}

function playerCard(player, captainId, viceId) {
  const card = $("#playerTemplate").content.firstElementChild.cloneNode(true);
  card.style.setProperty("--shirt", teamColour(player.teamId));
  card.querySelector(".player-name").textContent = player.name;
  card.querySelector(".player-team").textContent = `${player.team} · ${money(player.price)}`;
  card.querySelector(".player-score").textContent = `${player.projected.toFixed(1)} pts`;
  card.querySelector(".captain-badge").classList.toggle("hidden", player.id !== captainId);
  card.querySelector(".vice-badge").classList.toggle("hidden", player.id !== viceId);
  const run = upcomingFixtures(player, Number($("#horizon").value)).map((fixture) => fixtureLabel(player, fixture)).join(", ");
  card.title = `${player.name}: ${player.expectedMinutes.toFixed(0)} expected minutes/fixture · range ${player.floor.toFixed(1)}–${player.ceiling.toFixed(1)} · ${run || "No scheduled fixture"}`;
  return card;
}

function renderResults(squad, imported = []) {
  const { starters, bench } = pickStartingXI(squad);
  const ranked = [...starters].sort((a, b) => b.projected - a.projected);
  const captain = ranked[0];
  const vice = ranked[1];
  const pitch = $("#pitch");
  pitch.replaceChildren();
  ["FWD", "MID", "DEF", "GK"].forEach((position) => {
    const row = document.createElement("div");
    row.className = "position-row";
    starters.filter((p) => p.position === position).forEach((player) => row.append(playerCard(player, captain.id, vice.id)));
    pitch.append(row);
  });
  const benchNode = $("#bench");
  benchNode.replaceChildren(...bench.map((p) => playerCard(p, captain.id, vice.id)));

  state.recommendation = { squad: [...squad], starters: [...starters], bench: [...bench], captain, vice };

  const totalCost = squad.reduce((sum, p) => sum + p.price, 0);
  const xiProjection = starters.reduce((sum, p) => sum + p.projected, 0) + captain.projected;
  const counts = starters.reduce((acc, p) => ({ ...acc, [p.position]: (acc[p.position] || 0) + 1 }), {});
  $("#totalCost").textContent = money(totalCost);
  $("#projectedPoints").textContent = `${xiProjection.toFixed(1)} pts`;
  $("#formation").textContent = `${counts.DEF}-${counts.MID}-${counts.FWD}`;
  $("#captainPanel").innerHTML = `<strong class="captain-name">${captain.name}</strong><p class="captain-meta">${captain.team} · vice-captain ${vice.name}</p><div class="captain-score"><strong>${(captain.projected * 2).toFixed(1)}</strong><span>projected captain points</span></div>`;

  const premium = [...squad].sort((a, b) => b.price - a.price)[0];
  const value = [...squad].sort((a, b) => (b.projected / b.price) - (a.projected / a.price))[0];
  const differential = [...squad].filter((p) => p.selectedBy < 10).sort((a, b) => b.projected - a.projected)[0];
  const clashes = fixtureClashes(starters, state.currentEvent);
  const reasonItems = [
    clashes.length
      ? `${clashes.length} defensive/attacking fixture clash${clashes.length === 1 ? " was" : "es were"} unavoidable in GW ${state.currentEvent}; the model selected the legal XI with the fewest conflicts.`
      : `GW ${state.currentEvent} clash protection is active: no starting goalkeeper/defender faces one of your starting midfielders/forwards.`,
    `${captain.name} leads the expected-points model and earns the armband (${captain.floor.toFixed(1)}–${captain.ceiling.toFixed(1)} range).`,
    `${value.name} is the strongest value pick at ${money(value.price)}.`,
    differential ? `${differential.name} adds upside at only ${differential.selectedBy.toFixed(1)}% ownership.` : `${premium.name} anchors the squad's premium allocation.`,
  ];
  $("#reasonList").replaceChildren(...reasonItems.map((text) => {
    const li = document.createElement("li"); li.textContent = text; return li;
  }));

  renderTransfers(imported, squad, state.transferPlan);
  $("#results").classList.remove("hidden");
  $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
}

function recommendationText() {
  const recommendation = state.recommendation;
  if (!recommendation) return "";
  const group = (players, position) => players
    .filter((player) => player.position === position)
    .map((player) => `${player.name} (${player.team}, £${player.price.toFixed(1)}m)`)
    .join(", ");
  const { starters, bench, captain, vice } = recommendation;
  return [
    "FPL Optimal XI recommendation",
    `GK: ${group(starters, "GK")}`,
    `DEF: ${group(starters, "DEF")}`,
    `MID: ${group(starters, "MID")}`,
    `FWD: ${group(starters, "FWD")}`,
    `Bench: ${bench.map((player) => `${player.name} (${player.position})`).join(", ")}`,
    `Captain: ${captain.name}`,
    `Vice-captain: ${vice.name}`,
    "Review prices, availability, transfer costs and chips on the official FPL site before confirming.",
  ].join("\n");
}

async function applyToFpl() {
  const status = $("#applyStatus");
  const text = recommendationText();
  if (!text) {
    status.textContent = "Optimise a squad first.";
    status.classList.remove("hidden");
    return;
  }

  localStorage.setItem("fplOptimalRecommendation", JSON.stringify({
    createdAt: new Date().toISOString(),
    text,
    playerIds: state.recommendation.squad.map((player) => player.id),
    captainId: state.recommendation.captain.id,
    viceCaptainId: state.recommendation.vice.id,
  }));

  const officialWindow = window.open(FPL_SQUAD_URL, "_blank", "noopener,noreferrer");
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    copied = false;
  }

  status.textContent = copied
    ? "Recommendation copied. Review it on the official FPL page before confirming."
    : "Official FPL opened. Your recommendation remains saved in this browser.";
  if (!officialWindow) status.textContent += " Allow pop-ups if the FPL page did not open.";
  status.classList.remove("hidden");
}

function renderTransfers(importedIds, recommended, plan = null) {
  const card = $("#transferCard");
  if (!importedIds.length) { card.classList.add("hidden"); return; }
  const current = importedIds.map((id) => state.players.find((p) => p.id === id)).filter(Boolean);
  const recommendedIds = new Set(recommended.map((p) => p.id));
  const outgoing = current.filter((p) => !recommendedIds.has(p.id)).sort((a, b) => a.projected - b.projected);
  const currentIds = new Set(current.map((p) => p.id));
  const incoming = recommended.filter((p) => !currentIds.has(p.id)).sort((a, b) => b.projected - a.projected);
  const remainingIncoming = [...incoming];
  const moves = outgoing.slice(0, 3).map((out) => {
    const matchIndex = remainingIncoming.findIndex((player) => player.position === out.position);
    if (matchIndex < 0) return null;
    return { out, in: remainingIncoming.splice(matchIndex, 1)[0] };
  }).filter(Boolean);
  if (!moves.length) {
    $("#transferList").innerHTML = "<p class='fine-print'>Your squad is already very close to the model's recommendation.</p>";
  } else {
    $("#transferList").replaceChildren(...moves.map((move) => {
      const row = document.createElement("div");
      row.className = "transfer-row";
      row.innerHTML = `<div class="transfer-player"><strong>${move.out.name}</strong><span>${move.out.projected.toFixed(1)} pts</span></div><span class="transfer-arrow">→</span><div class="transfer-player"><strong>${move.in.name}</strong><span>+${Math.max(0, move.in.projected - move.out.projected).toFixed(1)} pts</span></div>`;
      return row;
    }));
  }
  if (plan?.hitCost > 0) {
    const warning = document.createElement("p");
    warning.className = "fine-print transfer-cost";
    warning.textContent = `Net projection includes a ${plan.hitCost}-point transfer hit.`;
    $("#transferList").append(warning);
  }
  card.classList.remove("hidden");
}

async function loadCurrentTeam(teamId) {
  if (!state.currentEvent) throw new Error("The current gameweek could not be identified.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let data = null;
  try {
    const params = new URLSearchParams({ teamId: String(teamId), event: String(state.currentEvent) });
    const response = await fetch(`${FPL_TEAM_API}?${params}`, { credentials: "omit", signal: controller.signal });
    if (response.ok) data = await response.json();
  } catch {
    data = null;
  } finally {
    clearTimeout(timeout);
  }
  if (!data) throw new Error("Your public FPL squad could not be imported. Check the Team ID, then try again in a moment.");
  state.importedIds = data.picks.map((pick) => pick.element);
  state.bank = Number(data.entry_history?.bank || 0) / 10;
  const value = Number(data.entry_history?.value || 1000) / 10;
  $("#budget").value = (value + state.bank).toFixed(1);
  return state.importedIds;
}

async function optimise() {
  const button = $("#optimiseButton");
  const message = $("#message");
  message.classList.add("hidden");
  button.disabled = true;
  button.querySelector("span:first-child").textContent = "Running calibrated model…";
  await new Promise((resolve) => setTimeout(resolve, 40));
  try {
    const horizon = Number($("#horizon").value);
    const risk = $("#risk").value;
    const budget = Number($("#budget").value);
    if (!Number.isFinite(budget) || budget < 64 || budget > 130) {
      throw new Error("Enter a valid squad budget between £64m and £130m.");
    }

    if (state.mode === "transfers") {
      const teamId = Number($("#teamId").value);
      if (!teamId) throw new Error("Enter your FPL team ID to analyse transfers.");
      await loadCurrentTeam(teamId);
    } else {
      state.importedIds = [];
      state.bank = 0;
    }

    const scored = projectPlayers(state.players, {
      fixtures: state.fixtures,
      teams: state.teams,
      currentEvent: state.currentEvent,
      historyByPlayer: state.historyByPlayer,
      predictionCalibration: state.predictionCalibration,
    }, horizon, risk);
    state.players = scored;

    let squad;
    state.transferPlan = null;
    if (state.mode === "transfers") {
      const currentSquad = state.importedIds
        .map((id) => scored.find((player) => player.id === id))
        .filter(Boolean);
      if (currentSquad.length !== 15) throw new Error("The imported public squad is incomplete for this gameweek.");
      const freeTransfers = Number($("#freeTransfers").value || 1);
      state.transferPlan = optimiseTransfers(currentSquad, scored, state.bank, freeTransfers, 3);
      squad = state.transferPlan?.squad;
    } else {
      squad = optimiseSquad(scored, budget);
    }

    if (!squad) throw new Error("No legal squad was found at this budget. Try increasing it slightly.");
    renderResults(squad, state.importedIds);
  } catch (error) {
    message.textContent = error.message || "Something went wrong. Please try again.";
    message.classList.remove("hidden");
  } finally {
    button.disabled = false;
    button.querySelector("span:first-child").textContent = state.mode === "new" ? "Optimise my squad" : "Plan my transfers";
  }
}

function demoData() {
  const clubs = ["ARS", "AVL", "BOU", "BRE", "BHA", "CHE", "CRY", "EVE", "FUL", "LEE", "LIV", "MCI", "MUN", "NEW", "NFO", "SUN", "TOT", "WHU", "WOL", "BUR"];
  clubs.forEach((name, index) => state.teams.set(index + 1, { name, short_name: name }));
  const firstNames = ["Raya", "Pickford", "Henderson", "Sels", "Pope", "Sanchez", "Alisson", "Vicario", "Saliba", "Gabriel", "Gvardiol", "Van Dijk", "Muñoz", "Porro", "Hall", "Robinson", "Konaté", "Timber", "Branthwaite", "Aït-Nouri", "Palmer", "Saka", "Salah", "Mbeumo", "Gordon", "Rogers", "Eze", "Bowen", "Fernandes", "Szoboszlai", "Kudus", "Johnson", "Ødegaard", "Semenyo", "Haaland", "Isak", "Watkins", "Solanke", "Wissa", "Wood", "Jackson", "Mateta", "Cunha", "Pedro"];
  const positions = [...Array(8).fill("GK"), ...Array(12).fill("DEF"), ...Array(14).fill("MID"), ...Array(10).fill("FWD")];
  return firstNames.map((name, i) => ({
    id: i + 1, name, web_name: name, team: (i % clubs.length) + 1, position: positions[i],
    price: positions[i] === "GK" ? 4 + (i % 3) * .5 : positions[i] === "DEF" ? 4 + (i % 5) * .45 : positions[i] === "MID" ? 4.5 + (i % 8) * .7 : 4.5 + (i % 7) * 1.05,
    form: 3.2 + seededNoise(i + 1, 4) * 5.6,
    pointsPerGame: 3 + seededNoise(i + 1, 7) * 5,
    totalPoints: 25 + seededNoise(i + 1, 11) * 180,
    selectedBy: 2 + seededNoise(i + 1, 19) * 42,
    ict: 30 + seededNoise(i + 1, 31) * 290,
    xgi: seededNoise(i + 1, 17) * 16,
    cleanSheets: Math.floor(seededNoise(i + 1, 23) * 14),
    minutes: 500 + seededNoise(i + 1, 29) * 2300,
    chance: 100, status: "a", news: "",
  }));
}

function dataFreshness(updatedAt) {
  const ageMinutes = Math.max(0, Math.round((Date.now() - new Date(updatedAt).getTime()) / 60000));
  if (ageMinutes < 2) return "updated just now";
  if (ageMinutes < 60) return `updated ${ageMinutes}m ago`;
  const ageHours = Math.round(ageMinutes / 60);
  return `updated ${ageHours}h ago`;
}

async function loadData() {
  const status = $("#dataStatus");
  try {
    const response = await fetch(`./data/fpl.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Refreshed FPL data unavailable");
    const snapshot = await response.json();
    const data = snapshot.bootstrap;
    if (!Array.isArray(data?.elements) || !Array.isArray(snapshot.fixtures)) {
      throw new Error("Invalid FPL data snapshot");
    }
    data.teams.forEach((team) => state.teams.set(team.id, team));
    state.fixtures = snapshot.fixtures;
    state.historyByPlayer = snapshot.historyByPlayer || {};
    state.predictionCalibration = snapshot.predictionCalibration || null;
    state.modelMetrics = snapshot.modelMetrics || null;
    state.players = data.elements.map(normalisePlayer);
    state.currentEvent = resolveTargetEvent(data.events);
    state.live = true;
    status.className = "data-status live";
    const validation = state.modelMetrics?.rankCorrelation != null ? ` · backtest ρ ${Number(state.modelMetrics.rankCorrelation).toFixed(2)}` : "";
    status.querySelector("span:last-child").textContent = `${state.players.length} live players · ${dataFreshness(snapshot.updatedAt)} · GW ${state.currentEvent || "—"}${validation}`;
  } catch (error) {
    console.error("FPL snapshot failed to load", error);
    state.players = demoData().map(normalisePlayer);
    state.currentEvent = 1;
    state.fixtures = Array.from({ length: 10 }, (_, index) => ({
      id: index + 1,
      event: 1,
      finished: false,
      team_h: index + 1,
      team_a: 20 - index,
    }));
    status.className = "data-status fallback";
    status.querySelector("span:last-child").textContent = "Demo data · refresh unavailable";
  }
}

$$('.mode-button').forEach((button) => button.addEventListener('click', () => {
  state.mode = button.dataset.mode;
  $$('.mode-button').forEach((item) => item.classList.toggle('active', item === button));
  $('#teamIdField').classList.toggle('hidden', state.mode !== 'transfers');
  $('#freeTransfersField').classList.toggle('hidden', state.mode !== 'transfers');
  $('#optimiseButton span:first-child').textContent = state.mode === 'new' ? 'Optimise my squad' : 'Plan my transfers';
  $('#actionHint').textContent = state.mode === 'new'
    ? 'Calibrates expected minutes, xG/xA, clean sheets, bonus and fixture scoring.'
    : 'Optimises up to three transfers after free-transfer and hit costs.';
}));

$('#optimiseButton').addEventListener('click', optimise);
$('#applyToFpl').addEventListener('click', applyToFpl);
loadData();
