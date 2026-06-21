// Simulación de partidas enteras para validar la metodología de la IA.
// Enfrenta la IA (Monte Carlo + EV + mezcla) contra rivales baseline y mide
// el porcentaje de partidas ganadas.
//
//   node test/simulate.js [juegosPorMatch] [samples]
//
import { newGame, nextHand, legalActions, applyAction } from '../src/engine.js';
import { recommend } from '../src/ai.js';
import { envidoPoints, trucoPower } from '../src/cards.js';

const GAMES = Number(process.argv[2] || 200);
const SAMPLES = Number(process.argv[3] || 40);

// ---- Utilidades ----
function actor(state) {
  return state.phase === 'play' ? state.turn : state.responder;
}
function sameAction(a, b) {
  if (a.type !== b.type) return false;
  if (a.type === 'call') return a.bet === b.bet;
  if (a.type === 'play') return a.card.rank === b.card.rank && a.card.suit === b.card.suit;
  return true;
}
function legalFor(state, player) {
  return legalActions(state).filter((x) => x.player === player);
}
function ensureLegal(state, player, action) {
  const legal = legalFor(state, player);
  if (action && legal.some((l) => sameAction(l, action))) return action;
  return legal[Math.floor(Math.random() * legal.length)];
}
function fullHand(state, p) {
  const played = [];
  for (const t of state.tricks) for (const pl of t.plays) if (pl.player === p) played.push(pl.card);
  return state.hands[p].concat(played);
}

// ---- Políticas ----
// La metodología a validar.
function aiPolicy(state, player) {
  const rec = recommend(state, player, { mix: true, samples: SAMPLES });
  return ensureLegal(state, player, rec.action);
}

// Rival aleatorio: cualquier acción legal con igual probabilidad.
function randomPolicy(state, player) {
  const legal = legalFor(state, player);
  return legal[Math.floor(Math.random() * legal.length)];
}

// Rival heurístico "casual competente": canta envido con buen tanto, acepta
// apuestas con manos/tantos decentes, canta truco con mano fuerte, juega la
// carta más alta. No farolea ni hace Monte Carlo.
function greedyPolicy(state, player) {
  const legal = legalFor(state, player);
  const handPow = state.hands[player].map(trucoPower);
  const best = handPow.length ? Math.max(...handPow) : 0;

  if (state.phase === 'envido-response') {
    const pts = envidoPoints(fullHand(state, player));
    if (pts >= 31) {
      const r = legal.find((a) => a.type === 'call' && a.bet === 'realenvido');
      if (r) return r;
    }
    return pick(legal, pts >= 26 ? 'quiero' : 'noquiero');
  }
  if (state.phase === 'truco-response') {
    return pick(legal, best >= 9 ? 'quiero' : 'noquiero'); // 9 = los 2
  }
  // phase play
  if (state.results.length === 0) {
    const env = legal.find((a) => a.type === 'call' && a.bet === 'envido');
    if (env && envidoPoints(fullHand(state, player)) >= 28) return env;
  }
  if (best >= 11) {
    // 7 bravo o mejor → canta truco a veces
    const truco = legal.find((a) => a.type === 'call' && a.bet === 'truco');
    if (truco && Math.random() < 0.6) return truco;
  }
  const plays = legal
    .filter((a) => a.type === 'play')
    .sort((a, b) => trucoPower(b.card) - trucoPower(a.card));
  if (plays.length) return plays[0];
  return legal[0];
}
function pick(legal, type) {
  return legal.find((a) => a.type === type) || legal[0];
}

// ---- Motor de partidas ----
// policies = [p0, p1]; startDealer alterna entre partidas para que el "mano"
// inicial no favorezca siempre al mismo asiento.
function playGame(policies, startDealer) {
  let g = newGame();
  g.dealer = startDealer;
  g.mano = startDealer === 0 ? 1 : 0;
  g.turn = g.mano;
  let safety = 0;
  while (g.phase !== 'game-over' && safety < 20000) {
    safety++;
    if (g.phase === 'hand-over') {
      g = nextHand(g);
      continue;
    }
    const p = actor(g);
    const action = policies[p](g, p);
    g = applyAction(g, action);
  }
  if (g.phase !== 'game-over') throw new Error('partida no terminó (loop?)');
  return g.scores[0] > g.scores[1] ? 0 : 1;
}

// Corre un match alternando asientos: la IA juega mitad como J0 y mitad como J1.
function runMatch(name, aiSeatPolicies) {
  let aiWins = 0;
  const t0 = Date.now();
  for (let i = 0; i < GAMES; i++) {
    const aiSeat = i % 2; // alterna 0/1
    const policies = aiSeat === 0 ? [aiPolicy, aiSeatPolicies] : [aiSeatPolicies, aiPolicy];
    const startDealer = i % 2; // alterna quién reparte
    const winner = playGame(policies, startDealer);
    if (winner === aiSeat) aiWins++;
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const pct = ((aiWins / GAMES) * 100).toFixed(1);
  console.log(`IA vs ${name.padEnd(10)} → ${aiWins}/${GAMES} = ${pct}%  (${secs}s)`);
  return aiWins / GAMES;
}

// Sanity: IA vs IA debería rondar 50%.
function runMirror() {
  let seat0Wins = 0;
  for (let i = 0; i < GAMES; i++) {
    const winner = playGame([aiPolicy, aiPolicy], i % 2);
    if (winner === 0) seat0Wins++;
  }
  const pct = ((seat0Wins / GAMES) * 100).toFixed(1);
  console.log(`IA vs IA (espejo) → J0 gana ${pct}% (debería rondar 50%)`);
}

// Control: el heurístico debe ganarle al aleatorio (prueba que es competente).
function runControl() {
  let gWins = 0;
  for (let i = 0; i < GAMES; i++) {
    const policies = i % 2 === 0 ? [greedyPolicy, randomPolicy] : [randomPolicy, greedyPolicy];
    const gSeat = i % 2 === 0 ? 0 : 1;
    if (playGame(policies, i % 2) === gSeat) gWins++;
  }
  const pct = ((gWins / GAMES) * 100).toFixed(1);
  console.log(`Heurístico vs Aleatorio → ${pct}% (control: debe ser > 50%)`);
  return gWins / GAMES;
}

console.log(`Simulando ${GAMES} partidas por match (samples=${SAMPLES})...\n`);
const vsRandom = runMatch('Aleatorio', randomPolicy);
const vsGreedy = runMatch('Heurístico', greedyPolicy);
runMirror();
const control = runControl();

console.log('');
let failed = 0;
function check(cond, msg) {
  console.log((cond ? '✓ ' : '✗ ') + msg);
  if (!cond) failed++;
}
check(vsRandom > 0.7, `la IA le gana cómodo al aleatorio (${(vsRandom * 100).toFixed(1)}% > 70%)`);
check(vsGreedy > 0.55, `la IA le gana al heurístico (${(vsGreedy * 100).toFixed(1)}% > 55%)`);
check(control > 0.5, `el heurístico le gana al aleatorio, así que es un rival válido (${(control * 100).toFixed(1)}% > 50%)`);
process.exit(failed > 0 ? 1 : 0);
