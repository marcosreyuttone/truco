// CFR del SUB-JUEGO de envido (heads-up, contexto 0-0, falta = 30).
//
// El envido es un juego chico y autocontenido: la única información privada de
// cada jugador es su TANTO (0..33). El árbol de apuestas es pequeño
// (envido/real/falta + quiero/noquiero/subir). Por eso el CFR converge rápido y
// casi exacto, a diferencia del CFR del truco completo.
//
// Jugadores del sub-juego:  0 = mano (juega/define primero, gana los empates),
//                           1 = pie.
//
// Uso:  node train/envido_cfr.js [iteraciones]   (default 2_000_000)
//
import { makeDeck, shuffle, envidoPoints } from '../src/cards.js';
import { writeFileSync } from 'node:fs';

const TARGET = 30;
const FALTA = TARGET; // contexto 0-0

// ---------- Valores de la cadena de envido (mismas reglas que el engine) ----------
function chainValue(chain) {
  if (chain.includes('F')) return FALTA;
  let v = 0;
  for (const b of chain) {
    if (b === 'E') v += 2;
    else if (b === 'R') v += 3;
  }
  return v;
}
function noQuieroValue(chain) {
  return Math.max(1, chainValue(chain.slice(0, -1)));
}
// Próximos cantos válidos dada la cadena (envido→(envido)→real→falta).
function nextBets(chain) {
  if (chain.includes('F')) return [];
  const out = [];
  const hasReal = chain.includes('R');
  const nE = chain.filter((b) => b === 'E').length;
  if (!hasReal && nE < 2) out.push('E');
  if (!hasReal) out.push('R');
  out.push('F');
  return out;
}

// ---------- Árbol del sub-juego ----------
// node: { hist, toAct, chain, opener, phase }
//   phase 'open'   : nadie cantó todavía; toAct decide pass/cantar.
//   phase 'respond': hay un canto pendiente; toAct responde n/q/subir.
const ROOT = { hist: '', toAct: 0, chain: [], opener: null, phase: 'open' };

function actionsOf(node) {
  if (node.phase === 'open') {
    return ['p', 'E', 'R', 'F'];
  }
  // respond
  return ['n', 'q', ...nextBets(node.chain)];
}

function apply(node, a) {
  if (node.phase === 'open') {
    if (a === 'p') {
      if (node.toAct === 1) return { terminal: 'bothpass' };
      return { hist: node.hist + 'p', toAct: 1, chain: [], opener: null, phase: 'open' };
    }
    // canta
    return {
      hist: node.hist + a,
      toAct: node.toAct === 0 ? 1 : 0,
      chain: [a],
      opener: node.toAct,
      phase: 'respond',
    };
  }
  // respond
  if (a === 'n') return { terminal: 'noquiero', chain: node.chain, lastBettor: other(node.toAct) };
  if (a === 'q') return { terminal: 'quiero', chain: node.chain };
  // subir (raise)
  return {
    hist: node.hist + a,
    toAct: node.toAct === 0 ? 1 : 0,
    chain: node.chain.concat([a]),
    opener: node.opener,
    phase: 'respond',
  };
}

const other = (p) => (p === 0 ? 1 : 0);

// Utilidad terminal en PUNTOS desde la perspectiva del mano (jugador 0).
function terminalUtil(child, tA, tB) {
  if (child.terminal === 'bothpass') return 0;
  if (child.terminal === 'noquiero') {
    const amt = noQuieroValue(child.chain);
    return child.lastBettor === 0 ? amt : -amt;
  }
  // quiero -> showdown
  const amt = chainValue(child.chain);
  const manoWins = tA >= tB; // el mano gana los empates
  return manoWins ? amt : -amt;
}

// ---------- CFR (muestreo de azar = reparto; CFR vainilla en el árbol) ----------
const regretSum = new Map();
const strategySum = new Map();

function infoKey(node, tanto) {
  // El historial público determina fase/chain/turno; el tanto es privado.
  return tanto + '|' + node.hist + '/' + node.phase + ':' + node.toAct;
}
function getNode(key, n) {
  let e = regretSum.get(key);
  if (!e) {
    e = new Float64Array(n);
    regretSum.set(key, e);
    strategySum.set(key, new Float64Array(n));
  }
  return e;
}
function regretMatch(R) {
  const n = R.length;
  const s = new Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    s[i] = R[i] > 0 ? R[i] : 0;
    sum += s[i];
  }
  if (sum > 0) for (let i = 0; i < n; i++) s[i] /= sum;
  else s.fill(1 / n);
  return s;
}

function cfr(node, tA, tB, p0, p1) {
  const p = node.toAct;
  const acts = actionsOf(node);
  const n = acts.length;
  const tanto = p === 0 ? tA : tB;
  const key = infoKey(node, tanto);
  const R = getNode(key, n);
  const sigma = regretMatch(R);

  const util = new Array(n);
  let nodeU0 = 0; // utilidad del mano en este nodo
  for (let i = 0; i < n; i++) {
    const child = apply(node, acts[i]);
    let u;
    if (child.terminal) u = terminalUtil(child, tA, tB);
    else u = cfr(child, tA, tB, p === 0 ? p0 * sigma[i] : p0, p === 1 ? p1 * sigma[i] : p1);
    util[i] = u;
    nodeU0 += sigma[i] * u;
  }

  // Actualización de arrepentimiento para el jugador que actúa.
  const cfReach = p === 0 ? p1 : p0;
  const reachSelf = p === 0 ? p0 : p1;
  const S = strategySum.get(key);
  for (let i = 0; i < n; i++) {
    const uForP = p === 0 ? util[i] : -util[i];
    const nodeForP = p === 0 ? nodeU0 : -nodeU0;
    R[i] += cfReach * (uForP - nodeForP);
    S[i] += reachSelf * sigma[i];
  }
  return nodeU0;
}

function deal() {
  const d = shuffle(makeDeck());
  return [envidoPoints(d.slice(0, 3)), envidoPoints(d.slice(3, 6))];
}

function train(iters) {
  const t0 = Date.now();
  let rootU = 0;
  for (let it = 1; it <= iters; it++) {
    const [tA, tB] = deal();
    rootU += cfr(ROOT, tA, tB, 1, 1);
    if (it % 200000 === 0) {
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(
        `  iter ${it}: infosets=${regretSum.size}, valor raíz (mano)=${(rootU / it).toFixed(4)}, ${secs}s`
      );
    }
  }
}

// Estrategia promedio.
function avgStrategy() {
  const out = {};
  for (const [key, S] of strategySum) {
    let sum = 0;
    for (const v of S) sum += v;
    out[key] = sum > 0 ? Array.from(S, (v) => +(v / sum).toFixed(4)) : null;
  }
  return out;
}

// ---------- Políticas para evaluar ----------
function sampleIdx(probs) {
  let r = Math.random();
  for (let i = 0; i < probs.length; i++) {
    if (r < probs[i]) return i;
    r -= probs[i];
  }
  return probs.length - 1;
}

// CFR: usa la estrategia promedio (infoset no visto -> uniforme).
function cfrPolicy(strat) {
  return (node, tanto) => {
    const acts = actionsOf(node);
    const probs = strat[infoKey(node, tanto)];
    const i = probs && probs.length === acts.length ? sampleIdx(probs) : Math.floor(Math.random() * acts.length);
    return acts[i];
  };
}

// Heurística que replica a la IA actual del juego:
//  - Responder: querer si P(ganar) >= umbral, asumiendo que el rival cantó con
//    buen tanto (sesgo callerStrong); subir poco con tanto muy alto.
//  - Cantar (abrir): cantar con tanto >= 26 (real si ~33), si no, pasar.
const CDF = (() => {
  const deck = makeDeck();
  const c = new Array(34).fill(0);
  let tot = 0;
  for (let i = 0; i < deck.length; i++)
    for (let j = i + 1; j < deck.length; j++)
      for (let k = j + 1; k < deck.length; k++) {
        c[envidoPoints([deck[i], deck[j], deck[k]])]++;
        tot++;
      }
  const less = new Array(34).fill(0);
  const leq = new Array(34).fill(0);
  let cum = 0;
  for (let v = 0; v <= 33; v++) {
    less[v] = cum / tot;
    cum += c[v];
    leq[v] = cum / tot;
  }
  return { less, leq };
})();
function pWinPrior(tanto, iAmMano) {
  // Sesgo callerStrong: el rival que cantó tiene tanto alto -> bajamos P.
  const base = iAmMano ? CDF.leq[tanto] : CDF.less[tanto];
  return base * 0.78; // factor que aproxima el sesgo "el rival cantó fuerte"
}
function heuristicPolicy() {
  return (node, tanto) => {
    if (node.phase === 'open') {
      if (tanto >= 33) return 'R';
      if (tanto >= 27) return 'E';
      return 'p';
    }
    const iAmMano = node.toAct === 0;
    const Vq = chainValue(node.chain);
    const Vnq = noQuieroValue(node.chain);
    const p = pWinPrior(tanto, iAmMano);
    const thr = (Vq - Vnq) / (2 * Vq);
    const raises = nextBets(node.chain);
    if (tanto >= 31 && raises.length) return raises[0]; // sube con tanto casi seguro
    return p >= thr ? 'q' : 'n';
  };
}

// Rival mentiroso: farolea ~20% con tanto bajo, valor con tanto alto.
function blufferPolicy() {
  return (node, tanto) => {
    if (node.phase === 'open') {
      if (tanto >= 24) return 'E';
      if (tanto < 18 && Math.random() < 0.2) return 'E'; // farol
      return 'p';
    }
    const raises = nextBets(node.chain);
    if (raises.length && tanto < 20 && Math.random() < 0.2) return raises[0]; // farol sube
    if (tanto >= 23) return 'q';
    if (tanto >= 19 && Math.random() < 0.5) return 'q';
    return 'n';
  };
}

// Juega una mano del sub-juego con policies[0]=mano, policies[1]=pie.
function playSub(policies, tA, tB) {
  let node = ROOT;
  let guard = 0;
  while (guard++ < 40) {
    const p = node.toAct;
    const tanto = p === 0 ? tA : tB;
    const a = policies[p](node, tanto);
    const child = apply(node, a);
    if (child.terminal) return terminalUtil(child, tA, tB); // perspectiva mano
    node = child;
  }
  return 0;
}

function evalMatch(name, polA, polB, N) {
  // Alterna asiento para que ninguno tenga sesgo de mano. polA es "el sujeto".
  let net = 0;
  for (let g = 0; g < N; g++) {
    const [t0, t1] = deal();
    if (g % 2 === 0) {
      net += playSub([polA, polB], t0, t1); // A es mano
    } else {
      net += -playSub([polB, polA], t0, t1); // A es pie -> negamos perspectiva
    }
  }
  console.log(`  ${name}: ${(net / N).toFixed(4)} puntos/mano (>0 = gana el sujeto A)`);
  return net / N;
}

// ---------- Main ----------
const iterations = Number(process.argv[2] || 2_000_000);
console.log(`Entrenando CFR del sub-juego de envido (contexto 0-0, falta=${FALTA}), ${iterations} iteraciones...`);
train(iterations);

const strat = avgStrategy();
console.log(`\nInfosets: ${regretSum.size}`);

const cfrP = cfrPolicy(strat);
const heurP = heuristicPolicy();
const bluffP = blufferPolicy();

const EVN = 200000;
console.log(`\nEvaluación (${EVN} manos por match):`);
evalMatch('CFR        vs Heurística', cfrP, heurP, EVN);
evalMatch('CFR        vs Mentiroso ', cfrP, bluffP, EVN);
evalMatch('Heurística vs Mentiroso ', heurP, bluffP, EVN);
evalMatch('CFR        vs CFR       ', cfrP, cfrP, EVN);
evalMatch('Heurística vs Heurística', heurP, heurP, EVN);

// ---------- Explotabilidad: mejor respuesta (best response) a una política fija ----------
// Entrena un aprendiz (one-sided CFR) contra una política fija y devuelve su
// valor: cuánto le saca un rival óptimo. ~0 => inexplotable (Nash).
function probsOfPolicy(pol) {
  // Convierte una policy determinista (devuelve token) en vector one-hot.
  return (node, tanto) => {
    const acts = actionsOf(node);
    const a = pol(node, tanto);
    return acts.map((x) => (x === a ? 1 : 0));
  };
}
function probsOfStrat(strat) {
  return (node, tanto) => {
    const acts = actionsOf(node);
    const p = strat[infoKey(node, tanto)];
    return p && p.length === acts.length ? p : acts.map(() => 1 / acts.length);
  };
}
function exploitability(fixedProbs, iters) {
  const reg = new Map();
  const str = new Map();
  const get = (key, n) => {
    let e = reg.get(key);
    if (!e) { e = new Float64Array(n); reg.set(key, e); str.set(key, new Float64Array(n)); }
    return e;
  };
  // walk para el aprendiz = learner (0 ó 1); el otro juega fijo (esperanza).
  function walk(node, tA, tB, learner, reachLearner) {
    const p = node.toAct;
    const acts = actionsOf(node);
    const n = acts.length;
    const tanto = p === 0 ? tA : tB;
    if (p === learner) {
      const key = infoKey(node, tanto);
      const R = get(key, n);
      const sigma = regretMatch(R);
      const util = new Array(n);
      let nodeU = 0;
      for (let i = 0; i < n; i++) {
        const child = apply(node, acts[i]);
        const u = child.terminal
          ? (learner === 0 ? terminalUtil(child, tA, tB) : -terminalUtil(child, tA, tB))
          : walk(child, tA, tB, learner, reachLearner * sigma[i]);
        util[i] = u;
        nodeU += sigma[i] * u;
      }
      const S = str.get(key);
      for (let i = 0; i < n; i++) {
        R[i] += util[i] - nodeU; // cfReach del rival fijo = 1 (esperanza completa)
        S[i] += reachLearner * sigma[i];
      }
      return nodeU;
    }
    // jugador fijo: esperanza sobre sus acciones.
    const probs = fixedProbs(node, tanto);
    let u = 0;
    for (let i = 0; i < n; i++) {
      if (probs[i] <= 0) continue;
      const child = apply(node, acts[i]);
      const ui = child.terminal
        ? (learner === 0 ? terminalUtil(child, tA, tB) : -terminalUtil(child, tA, tB))
        : walk(child, tA, tB, learner, reachLearner);
      u += probs[i] * ui;
    }
    return u;
  }
  let v0 = 0, v1 = 0;
  for (let it = 0; it < iters; it++) {
    const [tA, tB] = deal();
    v0 += walk(ROOT, tA, tB, 0, 1);
    v1 += walk(ROOT, tA, tB, 1, 1);
  }
  // Valor medio del aprendiz mejor-respondiendo (promedio de ambos asientos).
  // v0 = valor como mano; v1 = valor como pie (ya en su perspectiva).
  // Para Nash ≈ valor del juego promediado = ~0; mayor => más explotable.
  return (v0 / iters + v1 / iters) / 2;
}

console.log('\nExplotabilidad (cuánto le saca una mejor respuesta; ~0 = inexplotable):');
const BRI = 400000;
console.log(`  a la estrategia CFR : ${exploitability(probsOfStrat(strat), BRI).toFixed(4)} puntos/mano`);
console.log(`  a la Heurística     : ${exploitability(probsOfPolicy(heurP), BRI).toFixed(4)} puntos/mano`);

const path = new URL('./envido_strategy.json', import.meta.url).pathname;
writeFileSync(path, JSON.stringify(strat));
// También como módulo ES para que la web lo importe sin fetch.
const jsPath = new URL('../src/envido-strategy.js', import.meta.url).pathname;
const header =
  '// Estrategia de equilibrio (CFR) del sub-juego de envido (contexto 0-0,\n' +
  '// falta=30). Generado por train/envido_cfr.js. Claves: "tanto|hist/fase:asiento"\n' +
  '// (asiento 0 = mano, 1 = pie). Valores: probabilidades sobre las acciones del\n' +
  '// nodo. NO editar a mano.\n';
writeFileSync(jsPath, header + 'export const ENVIDO_STRATEGY = ' + JSON.stringify(strat) + ';\n');
console.log(`\nEstrategia guardada en train/envido_strategy.json y src/envido-strategy.js (${Object.keys(strat).length} infosets).`);
