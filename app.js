const FPL_API = "https://fantasy.premierleague.com/api";

const POSITION = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" };
const POSITION_LIMITS = { GK: 2, DEF: 5, MID: 5, FWD: 3 };
const START_LIMITS = { GK: [1, 1], DEF: [3, 5], MID: [2, 5], FWD: [1, 3] };
const SHIRT_COLOURS = ["#ef3340", "#79c9f5", "#f7d652", "#ffffff", "#9f7aea", "#ff8c42", "#58b368", "#f2a7c6"];

const state = {
  mode: "new",
  players: [],
  teams: new Map(),
  currentEvent: null,
  live: false,
  importedIds: [],
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
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
    position: POSITION[player.element_type] || player.position,
    price: player.now_cost ? player.now_cost / 10 : Number(player.price),
    form: Number(player.form || 0),
    pointsPerGame: Number(player.points_per_game || 0),
    totalPoints: Number(player.total_points || 0),
    selectedBy: Number(player.selected_by_percent || 0),
    ict: Number(player.ict_index || 0),
    xgi: Number(player.expected_goal_involvements || 0),
    cleanSheets: Number(player.clean_sheets || 0),
    minutes: Number(player.minutes || 0),
    chance: player.chance_of_playing_next_round == null ? 100 : Number(player.chance_of_playing_next_round),
    status: player.status || "a",
    news: player.news || "",
  };
}

function projection(player, horizon, risk) {
  const availability = clamp(player.chance / 100, 0.08, 1);
  const minutesConfidence = clamp(player.minutes / 900, 0.35, 1);
  const base = player.pointsPerGame * 0.45 + player.form * 0.33;
  const threat = player.xgi * 0.075 + player.ict * 0.0025;
  const defence = ["GK", "DEF"].includes(player.position) ? player.cleanSheets * 0.035 : 0;
  const horizonLift = Math.pow(Number(horizon), 0.78);
  let score = (base + threat + defence + 0.55) * availability * (0.75 + minutesConfidence * 0.25) * horizonLift;

  if (risk === "safe") score *= 0.92 + Math.min(player.selectedBy, 35) / 350;
  if (risk === "differential") score *= 1 + Math.max(0, 14 - player.selectedBy) / 115;
  return Number(score.toFixed(2));
}

function reserveMinimum(players, remainingCounts, clubCounts) {
  let minimum = 0;
  for (const [position, count] of Object.entries(remainingCounts)) {
    if (count <= 0) continue;
    const eligible = players
      .filter((p) => p.position === position && (clubCounts.get(p.teamId) || 0) < 3)
      .sort((a, b) => a.price - b.price)
      .slice(0, count);
    if (eligible.length < count) return Infinity;
    minimum += eligible.reduce((sum, p) => sum + p.price, 0);
  }
  return minimum;
}

function buildCandidate(players, budget, seed) {
  const squad = [];
  const clubCounts = new Map();
  const counts = { ...POSITION_LIMITS };
  let spent = 0;
  const shuffled = players
    .map((p) => ({ ...p, searchScore: p.projected * (0.93 + seededNoise(p.id, seed) * 0.14) + p.projected / Math.max(p.price, 4) * 0.22 }))
    .sort((a, b) => b.searchScore - a.searchScore);

  while (squad.length < 15) {
    let choice = null;
    let best = -Infinity;
    for (const player of shuffled) {
      if (squad.some((p) => p.id === player.id) || counts[player.position] <= 0) continue;
      if ((clubCounts.get(player.teamId) || 0) >= 3) continue;
      const nextCounts = { ...counts, [player.position]: counts[player.position] - 1 };
      const reserve = reserveMinimum(players.filter((p) => !squad.some((s) => s.id === p.id) && p.id !== player.id), nextCounts, new Map(clubCounts).set(player.teamId, (clubCounts.get(player.teamId) || 0) + 1));
      if (spent + player.price + reserve > budget + 0.001) continue;
      const affordability = player.projected / Math.pow(player.price, 0.18);
      if (affordability > best) { best = affordability; choice = player; }
    }
    if (!choice) return null;
    squad.push(choice);
    counts[choice.position] -= 1;
    clubCounts.set(choice.teamId, (clubCounts.get(choice.teamId) || 0) + 1);
    spent += choice.price;
  }
  return improveSquad(squad, players, budget);
}

function buildCheapestLegalSquad(players, budget) {
  const squad = [];
  const clubCounts = new Map();
  for (const position of ["GK", "DEF", "MID", "FWD"]) {
    const candidates = players
      .filter((player) => player.position === position)
      .sort((a, b) => a.price - b.price || b.projected - a.projected);
    while (squad.filter((player) => player.position === position).length < POSITION_LIMITS[position]) {
      const choice = candidates.find((player) =>
        !squad.some((picked) => picked.id === player.id) &&
        (clubCounts.get(player.teamId) || 0) < 3
      );
      if (!choice) return null;
      squad.push(choice);
      clubCounts.set(choice.teamId, (clubCounts.get(choice.teamId) || 0) + 1);
    }
  }
  const spend = squad.reduce((sum, player) => sum + player.price, 0);
  return spend <= budget + 0.001 ? improveSquad(squad, players, budget) : null;
}

function improveSquad(squad, pool, budget) {
  let current = [...squad];
  let improved = true;
  let loops = 0;
  while (improved && loops < 30) {
    improved = false;
    loops += 1;
    const spent = current.reduce((sum, p) => sum + p.price, 0);
    const clubCounts = current.reduce((map, p) => map.set(p.teamId, (map.get(p.teamId) || 0) + 1), new Map());
    let bestSwap = null;
    for (const outgoing of current) {
      for (const incoming of pool) {
        if (incoming.position !== outgoing.position || current.some((p) => p.id === incoming.id)) continue;
        if (spent - outgoing.price + incoming.price > budget + 0.001) continue;
        const sameClub = incoming.teamId === outgoing.teamId;
        if (!sameClub && (clubCounts.get(incoming.teamId) || 0) >= 3) continue;
        const gain = incoming.projected - outgoing.projected;
        if (gain > 0.02 && (!bestSwap || gain > bestSwap.gain)) bestSwap = { outgoing, incoming, gain };
      }
    }
    if (bestSwap) {
      current = current.map((p) => p.id === bestSwap.outgoing.id ? bestSwap.incoming : p);
      improved = true;
    }
  }
  return current;
}

function optimiseSquad(players, budget) {
  let best = null;
  const available = players.filter((p) => p.status !== "u" && p.chance >= 25 && p.price <= budget - 52);
  const baseline = buildCheapestLegalSquad(available, budget);
  if (baseline) best = { squad: baseline, score: baseline.reduce((sum, player) => sum + player.projected, 0) };
  for (let seed = 1; seed <= 140; seed += 1) {
    const candidate = buildCandidate(available, budget, seed);
    if (!candidate) continue;
    const score = candidate.reduce((sum, p) => sum + p.projected, 0);
    if (!best || score > best.score) best = { squad: candidate, score };
  }
  return best?.squad || null;
}

function pickStartingXI(squad) {
  const byPosition = Object.groupBy
    ? Object.groupBy(squad, (p) => p.position)
    : squad.reduce((acc, p) => ((acc[p.position] ||= []).push(p), acc), {});
  Object.values(byPosition).forEach((group) => group.sort((a, b) => b.projected - a.projected));
  const starters = [byPosition.GK[0], ...byPosition.DEF.slice(0, 3), ...byPosition.MID.slice(0, 2), ...byPosition.FWD.slice(0, 1)];
  const remainingSlots = 11 - starters.length;
  const optional = [...byPosition.DEF.slice(3), ...byPosition.MID.slice(2), ...byPosition.FWD.slice(1)]
    .sort((a, b) => b.projected - a.projected)
    .slice(0, remainingSlots);
  starters.push(...optional);
  const starterIds = new Set(starters.map((p) => p.id));
  const bench = squad.filter((p) => !starterIds.has(p.id)).sort((a, b) => {
    if (a.position === "GK") return -1;
    if (b.position === "GK") return 1;
    return b.projected - a.projected;
  });
  return { starters, bench };
}

function playerCard(player, captainId, viceId) {
  const card = $("#playerTemplate").content.firstElementChild.cloneNode(true);
  card.style.setProperty("--shirt", teamColour(player.teamId));
  card.querySelector(".player-name").textContent = player.name;
  card.querySelector(".player-team").textContent = `${player.team} · ${money(player.price)}`;
  card.querySelector(".player-score").textContent = `${player.projected.toFixed(1)} pts`;
  card.querySelector(".captain-badge").classList.toggle("hidden", player.id !== captainId);
  card.querySelector(".vice-badge").classList.toggle("hidden", player.id !== viceId);
  card.title = `${player.name}: form ${player.form.toFixed(1)}, ${player.selectedBy.toFixed(1)}% owned`;
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
  const reasonItems = [
    `${captain.name} leads the model on projected return and earns the armband.`,
    `${value.name} is the strongest value pick at ${money(value.price)}.`,
    differential ? `${differential.name} adds upside at only ${differential.selectedBy.toFixed(1)}% ownership.` : `${premium.name} anchors the squad's premium allocation.`,
  ];
  $("#reasonList").replaceChildren(...reasonItems.map((text) => {
    const li = document.createElement("li"); li.textContent = text; return li;
  }));

  renderTransfers(imported, squad);
  $("#results").classList.remove("hidden");
  $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderTransfers(importedIds, recommended) {
  const card = $("#transferCard");
  if (!importedIds.length) { card.classList.add("hidden"); return; }
  const current = importedIds.map((id) => state.players.find((p) => p.id === id)).filter(Boolean);
  const recommendedIds = new Set(recommended.map((p) => p.id));
  const outgoing = current.filter((p) => !recommendedIds.has(p.id)).sort((a, b) => a.projected - b.projected);
  const currentIds = new Set(current.map((p) => p.id));
  const incoming = recommended.filter((p) => !currentIds.has(p.id)).sort((a, b) => b.projected - a.projected);
  const moves = outgoing.slice(0, 3).map((out, index) => {
    const samePosition = incoming.filter((p) => p.position === out.position);
    return { out, in: samePosition[0] || incoming[index] };
  }).filter((move) => move.in);
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
  card.classList.remove("hidden");
}

async function loadCurrentTeam(teamId) {
  if (!state.currentEvent) throw new Error("The current gameweek could not be identified.");
  const response = await fetch(`${FPL_API}/entry/${teamId}/event/${state.currentEvent}/picks/`);
  if (!response.ok) throw new Error("That team could not be loaded. Check the ID and try again.");
  const data = await response.json();
  state.importedIds = data.picks.map((pick) => pick.element);
  const bank = Number(data.entry_history?.bank || 0) / 10;
  const value = Number(data.entry_history?.value || 1000) / 10;
  $("#budget").value = (value + bank).toFixed(1);
  return state.importedIds;
}

async function optimise() {
  const button = $("#optimiseButton");
  const message = $("#message");
  message.classList.add("hidden");
  button.disabled = true;
  button.querySelector("span:first-child").textContent = "Searching combinations…";
  await new Promise((resolve) => setTimeout(resolve, 40));
  try {
    const horizon = Number($("#horizon").value);
    const risk = $("#risk").value;
    let budget = Number($("#budget").value);
    if (state.mode === "transfers") {
      const teamId = Number($("#teamId").value);
      if (!teamId) throw new Error("Enter your FPL team ID to analyse transfers.");
      await loadCurrentTeam(teamId);
      budget = Number($("#budget").value);
    } else {
      state.importedIds = [];
    }
    const scored = state.players.map((p) => ({ ...p, projected: projection(p, horizon, risk) }));
    state.players = scored;
    const squad = optimiseSquad(scored, budget);
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

async function loadData() {
  const status = $("#dataStatus");
  try {
    const response = await fetch(`${FPL_API}/bootstrap-static/`);
    if (!response.ok) throw new Error("Live data unavailable");
    const data = await response.json();
    data.teams.forEach((team) => state.teams.set(team.id, team));
    state.players = data.elements.map(normalisePlayer);
    state.currentEvent = data.events.find((event) => event.is_current)?.id || data.events.find((event) => event.is_next)?.id;
    state.live = true;
    status.className = "data-status live";
    status.querySelector("span:last-child").textContent = `${state.players.length} live players · GW ${state.currentEvent || "—"}`;
  } catch {
    state.players = demoData().map(normalisePlayer);
    state.currentEvent = 1;
    status.className = "data-status fallback";
    status.querySelector("span:last-child").textContent = "Demo data · live feed blocked";
  }
}

$$('.mode-button').forEach((button) => button.addEventListener('click', () => {
  state.mode = button.dataset.mode;
  $$('.mode-button').forEach((item) => item.classList.toggle('active', item === button));
  $('#teamIdField').classList.toggle('hidden', state.mode !== 'transfers');
  $('#optimiseButton span:first-child').textContent = state.mode === 'new' ? 'Optimise my squad' : 'Plan my transfers';
  $('#actionHint').textContent = state.mode === 'new'
    ? 'Uses current price, form, expected involvement and availability.'
    : 'Imports your latest public squad and ranks up to three upgrades.';
}));

$('#optimiseButton').addEventListener('click', optimise);
loadData();
