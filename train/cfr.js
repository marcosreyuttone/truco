// Entrenamiento CFR del Truco (External-Sampling MCCFR).
//
// ADITIVO: no toca el motor ni la IA Monte Carlo. Reusa las reglas del engine
// (legalActions/applyAction) y produce una estrategia promedio por conjunto de
// información. Converge (en el límite) a un equilibrio de Nash = no explotable.
//
// Abstracción casi sin pérdida en el truco heads-up:
//   - Las cartas se representan por su PODER (1..14): quién gana una baza
//     depende sólo del poder; jugar dos cartas del mismo poder es idéntico.
//   - La mano agrega su tanto de ENVIDO (0..33), que es lo único que importa
//     para el envido.
//   Entrenamos en el contexto de inicio de partida (marcador 0-0; falta = 30).
//
// Uso:  node train/cfr.js [iteraciones]      (default 50000)
//
import { createHandState, legalActions, applyAction, other } from '../src/engine.js';
import { makeDeck, shuffle, trucoPower, envidoPoints } from '../src/cards.js';
import { recommend } from '../src/ai.js';
import { writeFileSync } from 'node:fs';

const regretSum = new Map(); // infoset -> Float64Array (arrepentimiento acum.)
const strategySum = new Map(); // infoset -> Float64Array (estrategia promedio)

const actorOf = (s) => (s.phase === 'play' ? s.turn : s.responder);
const isTerminal = (s) => s.phase === 'hand-over' || s.phase === 'game-over';

function playedBy(state, p) {
  const out = [];
  for (const t of state.tricks) for (const pl of t.plays) if (pl.player === p) out.push(pl.card);
  return out;
}

// --- Abstracción / claves de información ---
function abstractHand(state, p) {
  const full = state.hands[p].concat(playedBy(state, p));
  const powers = full.map(trucoPower).sort((a, b) => a - b).join(',');
  return powers + '/' + envidoPoints(full);
}
function abstractPublic(state) {
  const tricks = state.tricks
    .map((t) => t.plays.map((pl) => pl.player + ':' + trucoPower(pl.card)).join('>'))
    .join('|');
  const e = state.envido;
  const env = [e.chain.join('-'), e.state, e.resolved ? 1 : 0, e.winner ?? '', (e.shown || []).join('/')].join(',');
  const tr = state.truco;
  const tru = [tr.chain.join('-'), tr.accepted ? 1 : 0, tr.caller ?? '', tr.canRaiseBy ?? ''].join(',');
  return [state.mano, state.results.join(''), tricks, env, tru, state.suspendedTruco ? 1 : 0, state.phase, state.turn, state.responder].join('#');
}
function infosetKey(state, p) {
  return abstractHand(state, p) + '@' + abstractPublic(state);
}

// Acciones abstractas (por poder) -> una acción concreta representante.
function abstractActions(state) {
  const p = actorOf(state);
  const legal = legalActions(state).filter((a) => a.player === p);
  const m = new Map();
  for (const a of legal) {
    const label =
      a.type === 'play' ? 'play:' + trucoPower(a.card) : a.type === 'call' ? 'call:' + a.bet : a.type;
    if (!m.has(label)) m.set(label, a);
  }
  return m;
}

function regretMatch(r) {
  const s = new Array(r.length);
  let sum = 0;
  for (let i = 0; i < r.length; i++) {
    s[i] = r[i] > 0 ? r[i] : 0;
    sum += s[i];
  }
  if (sum > 0) for (let i = 0; i < r.length; i++) s[i] /= sum;
  else s.fill(1 / r.length);
  return s;
}
function sampleIdx(sigma) {
  let r = Math.random();
  for (let i = 0; i < sigma.length; i++) {
    if (r < sigma[i]) return i;
    r -= sigma[i];
  }
  return sigma.length - 1;
}

// --- External Sampling MCCFR ---
function walk(state, i) {
  if (isTerminal(state)) return state.scores[i] - state.scores[other(i)];

  const p = actorOf(state);
  const am = abstractActions(state);
  const labels = [...am.keys()].sort();
  const n = labels.length;
  if (n === 1) return walk(applyAction(state, am.get(labels[0])), i); // sin decisión

  const key = infosetKey(state, p);
  let R = regretSum.get(key);
  if (!R || R.length !== n) {
    R = new Float64Array(n);
    regretSum.set(key, R);
    strategySum.set(key, new Float64Array(n));
  }
  const sigma = regretMatch(R);

  if (p === i) {
    const util = new Array(n);
    let nodeUtil = 0;
    for (let k = 0; k < n; k++) {
      util[k] = walk(applyAction(state, am.get(labels[k])), i);
      nodeUtil += sigma[k] * util[k];
    }
    for (let k = 0; k < n; k++) R[k] += util[k] - nodeUtil;
    return nodeUtil;
  } else {
    const S = strategySum.get(key);
    for (let k = 0; k < n; k++) S[k] += sigma[k];
    const k = sampleIdx(sigma);
    return walk(applyAction(state, am.get(labels[k])), i);
  }
}

function randomDeal() {
  const d = shuffle(makeDeck());
  return [d.slice(0, 3), d.slice(3, 6)];
}

function train(iterations) {
  const t0 = Date.now();
  let rootUtil = 0;
  for (let it = 1; it <= iterations; it++) {
    const hands = randomDeal();
    const state = createHandState({ target: 30, scores: [0, 0], dealer: it % 2, hands });
    rootUtil += walk(state, 0);
    walk(state, 1);
    if (it % 5000 === 0) {
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(
        `  iter ${it}: infosets=${regretSum.size}, valor medio raíz=${(rootUtil / it).toFixed(3)} (→0 ideal), ${secs}s`
      );
    }
  }
}

// Estrategia promedio normalizada (sólo infosets visitados lo suficiente).
function averageStrategy(minWeight = 1) {
  const out = {};
  let kept = 0;
  for (const [key, S] of strategySum) {
    let sum = 0;
    for (const v of S) sum += v;
    if (sum < minWeight) continue;
    out[key] = Array.from(S, (v) => +(v / sum).toFixed(4));
    kept++;
  }
  return { out, kept };
}

// --- Evaluación: jugar manos con la estrategia CFR vs un rival ---
function cfrAction(state, player, strat) {
  const am = abstractActions(state);
  const labels = [...am.keys()].sort();
  if (labels.length === 1) return am.get(labels[0]);
  const probs = strat[infosetKey(state, player)];
  let k;
  if (probs && probs.length === labels.length) k = sampleIdx(probs);
  else k = Math.floor(Math.random() * labels.length); // infoset no visto: al azar
  return am.get(labels[k]);
}

function playHand(stratPolicies) {
  const hands = randomDeal();
  let s = createHandState({ target: 30, scores: [0, 0], dealer: Math.random() < 0.5 ? 0 : 1, hands });
  let guard = 0;
  while (!isTerminal(s) && guard++ < 200) {
    const p = actorOf(s);
    s = applyAction(s, stratPolicies[p](s, p));
  }
  return s.scores[0] - s.scores[1];
}

function evalVs(name, oppPolicy, strat, N) {
  let net = 0;
  for (let g = 0; g < N; g++) {
    const cfrSeat = g % 2;
    const policies = [];
    policies[cfrSeat] = (s, p) => cfrAction(s, p, strat);
    policies[other(cfrSeat)] = oppPolicy;
    const r = playHand(policies);
    net += cfrSeat === 0 ? r : -r; // net desde la perspectiva del CFR
  }
  console.log(`  CFR vs ${name}: ${(net / N).toFixed(3)} puntos/mano promedio (>0 = CFR gana)`);
}

// --- Main ---
const iterations = Number(process.argv[2] || 50000);
console.log(`Entrenando CFR (External-Sampling MCCFR), ${iterations} iteraciones...`);
train(iterations);

const { out: strat, kept } = averageStrategy(1);
console.log(`\nInfosets totales: ${regretSum.size}; con datos suficientes: ${kept}`);

console.log('\nEvaluación (1000 manos cada una):');
const randomPolicy = (s, p) => {
  const l = legalActions(s).filter((a) => a.player === p);
  return l[Math.floor(Math.random() * l.length)];
};
const mcPolicy = (s, p) => {
  const rec = recommend(s, p, { mix: true, samples: 40 });
  return rec.action || randomPolicy(s, p);
};
evalVs('Aleatorio', randomPolicy, strat, 1000);
evalVs('Monte Carlo (la IA actual)', mcPolicy, strat, 300);

const path = new URL('./strategy.json', import.meta.url).pathname;
writeFileSync(path, JSON.stringify(strat));
const mb = (JSON.stringify(strat).length / 1e6).toFixed(1);
console.log(`\nEstrategia guardada en train/strategy.json (${mb} MB, ${kept} infosets).`);
