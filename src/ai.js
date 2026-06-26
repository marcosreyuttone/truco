// Inteligencia del Truco: evaluación probabilística e información incompleta.
//
// Idea central:
//  - Para el TRUCO, lo que importa es la probabilidad de ganar la mano. La
//    estimamos por Monte Carlo: muestreamos las cartas ocultas del rival
//    (consistentes con lo que ya se vio) y resolvemos el final de cartas de
//    forma EXACTA con minimax. El promedio de victorias es P(ganar).
//  - Para el ENVIDO, enumeramos todas las manos posibles del rival y sacamos
//    la distribución exacta de sus puntos.
//  - Las decisiones (quiero / no quiero / subir / cantar) se toman por VALOR
//    ESPERADO en puntos (neutral al riesgo), con algo de bluff para no ser
//    explotable (estrategias mixtas).

import {
  makeDeck,
  removeCards,
  shuffle,
  compareCards,
  envidoPoints,
  trucoPower,
} from './cards.js';
import {
  handWinner,
  envidoChainValue,
  envidoNoQuieroValue,
  faltaValue,
  TRUCO_QUIERO,
  TRUCO_NOQUIERO,
  other,
  applyAction,
} from './engine.js';
import { ENVIDO_STRATEGY } from './envido-strategy.js';
import { ENVIDO_CFR } from './config.js';

// ---------- Resolución exacta del final de cartas (minimax) ----------
//
// handsLeft: [cartas restantes J0, cartas restantes J1]
// results:   resultados de bazas ya jugadas (0 | 1 | 'parda')
// lead:      null o { player, card } (carta líder de la baza en curso)
// turn:      a quién le toca jugar
// mano:      quién es mano (gana pardas de definición)
// Devuelve el ganador de la mano (0 | 1) con juego óptimo de ambos.
function solveEndgame(handsLeft, results, lead, turn, mano) {
  const decided = handWinner(results, mano);
  if (decided !== null) return decided;

  const pl = turn;
  const cards = handsLeft[pl];
  let fallback = null;

  for (const c of cards) {
    const nh = [handsLeft[0].slice(), handsLeft[1].slice()];
    nh[pl] = nh[pl].filter((x) => !(x.rank === c.rank && x.suit === c.suit));

    let outcome;
    if (!lead) {
      outcome = solveEndgame(nh, results, { player: pl, card: c }, other(pl), mano);
    } else {
      const cmp = compareCards(lead.card, c);
      let res;
      if (cmp > 0) res = lead.player;
      else if (cmp < 0) res = pl;
      else res = 'parda';
      const nresults = results.concat([res]);
      const hw = handWinner(nresults, mano);
      if (hw !== null) outcome = hw;
      else {
        const leader = res === 'parda' ? mano : res;
        outcome = solveEndgame(nh, nresults, null, leader, mano);
      }
    }
    if (outcome === pl) return pl; // el que juega prefiere ganar
    fallback = outcome;
  }
  return fallback;
}

// Mejor carta a jugar resolviendo el final de cartas EXACTO (minimax).
// Usa que en el rollout las cartas de ambos están sampleadas (info perfecta),
// igual criterio que handWinProbability. Devuelve una carta que mantiene la
// mano ganable (si se puede); si no, una cualquiera (perdés igual).
function bestEndgameCard(handsLeft, results, lead, turn, mano) {
  const cards = handsLeft[turn];
  let fallback = cards[0];
  for (const c of cards) {
    const nh = [handsLeft[0].slice(), handsLeft[1].slice()];
    nh[turn] = nh[turn].filter((x) => !(x.rank === c.rank && x.suit === c.suit));
    let outcome;
    if (!lead) {
      outcome = solveEndgame(nh, results, { player: turn, card: c }, other(turn), mano);
    } else {
      const cmp = compareCards(lead.card, c);
      const res = cmp > 0 ? lead.player : cmp < 0 ? turn : 'parda';
      const nresults = results.concat([res]);
      const hw = handWinner(nresults, mano);
      if (hw !== null) outcome = hw;
      else {
        const leader = res === 'parda' ? mano : res;
        outcome = solveEndgame(nh, nresults, null, leader, mano);
      }
    }
    if (outcome === turn) return c;
    fallback = c;
  }
  return fallback;
}

// Cartas ya jugadas por un jugador.
function playedBy(state, p) {
  const out = [];
  for (const t of state.tricks) {
    for (const pl of t.plays) if (pl.player === p) out.push(pl.card);
  }
  return out;
}

function fullHand(state, p) {
  return state.hands[p].concat(playedBy(state, p));
}

function allPlayed(state) {
  const out = [];
  for (const t of state.tricks) for (const pl of t.plays) out.push(pl.card);
  return out;
}

// Estado de baza para el final de cartas (independiente de la fase de apuestas).
function trickContext(state) {
  const trick = state.tricks[state.tricks.length - 1];
  if (trick.plays.length === 1) {
    const lead = { player: trick.plays[0].player, card: trick.plays[0].card };
    return { lead, turn: other(lead.player) };
  }
  // nadie jugó la baza en curso: líder = ganador anterior (parda => mano)
  let leader;
  if (state.results.length === 0) leader = state.mano;
  else {
    const last = state.results[state.results.length - 1];
    leader = last === 'parda' ? state.mano : last;
  }
  return { lead: null, turn: leader };
}

// Análisis con INFORMACIÓN PERFECTA (ambas manos conocidas): ganador del juego
// de cartas restante por minimax exacto. Sirve para auditar errores de juego de
// cartas a posteriori (no usa muestreo: las dos manos están dadas).
export function exactCardWinner(state) {
  const { lead, turn } = trickContext(state);
  return solveEndgame([state.hands[0], state.hands[1]], state.results, lead, turn, state.mano);
}
// ¿Qué resultado fuerza jugar la carta `card` ahora (info perfecta)? Devuelve el
// ganador minimax de la mano si se juega esa carta y luego ambos juegan óptimo.
export function exactWinnerIfPlay(state, player, card) {
  const { lead, turn } = trickContext(state);
  if (turn !== player) return null;
  const nh = [state.hands[0].slice(), state.hands[1].slice()];
  nh[player] = nh[player].filter((x) => !(x.rank === card.rank && x.suit === card.suit));
  if (!lead) return solveEndgame(nh, state.results, { player, card }, other(player), state.mano);
  const cmp = compareCards(lead.card, card);
  const res = cmp > 0 ? lead.player : cmp < 0 ? player : 'parda';
  const nresults = state.results.concat([res]);
  const hw = handWinner(nresults, state.mano);
  if (hw !== null) return hw;
  const leader = res === 'parda' ? state.mano : res;
  return solveEndgame(nh, nresults, null, leader, state.mano);
}

// ---------- Probabilidad de ganar la mano (Monte Carlo) ----------

// Peso de una mano del rival según su fuerza (las manos fuertes cantan más).
// Sirve para condicionar cuando el rival cantó: su mano no es al azar.
function oppStrengthWeight(cards, center = 4) {
  if (!cards.length) return 1;
  const mean = cards.reduce((s, c) => s + trucoPower(c), 0) / cards.length;
  // Logística: el rival que canta este nivel tiene mano fuerte. A mayor
  // "center", más se concentra el peso en manos fuertes (baja mi probabilidad).
  return 1 / (1 + Math.exp(-(mean - center)));
}

// Peso de una mano del rival dada la INFORMACIÓN que reveló con sus apuestas:
//  - si cantó truco => mano fuerte (callerStrong).
//  - si RECHAZÓ el envido (no quiero) => su tanto es probablemente bajo, así
//    que pesan más las manos con tanto bajo.
function oppBeliefWeight(oppFull, state, opp, opts) {
  let w = 1;
  if (opts && opts.callerStrong) w *= oppStrengthWeight(oppFull, opts.center);
  const e = state.envido;
  if (e && e.resolved && e.state === 'declined' && other(e.caller) === opp) {
    const t = envidoPoints(oppFull);
    w *= 1 / (1 + Math.exp((t - 24) / 3)); // tanto alto => peso bajo
  }
  return w;
}

// opts.callerStrong: pondera asumiendo que el rival cantó (sesgo a mano fuerte).
// opts.center: cuán fuerte se asume (sube con el nivel del canto).
export function handWinProbability(state, me, samples = 300, opts = {}) {
  const opp = other(me);
  const oppCount = state.hands[opp].length;
  const myRemaining = state.hands[me];

  // Si ya no quedan cartas ocultas, resolvemos exacto una sola vez.
  const known = myRemaining.concat(allPlayed(state));
  const unknownDeck = removeCards(makeDeck(), known);

  if (oppCount === 0) {
    const { lead, turn } = trickContext(state);
    const handsLeft = [];
    handsLeft[me] = myRemaining;
    handsLeft[opp] = [];
    return solveEndgame(handsLeft, state.results, lead, turn, state.mano) === me ? 1 : 0;
  }

  const oppPlayed = playedBy(state, opp);
  const combos = consistentOppCombos(state, opp, unknownDeck, oppCount, oppPlayed);
  let wTotal = 0;
  let wWins = 0;
  for (let i = 0; i < samples; i++) {
    const oppCards = combos
      ? combos[(Math.random() * combos.length) | 0]
      : shuffle(unknownDeck).slice(0, oppCount);
    const { lead, turn } = trickContext(state);
    const handsLeft = [];
    handsLeft[me] = myRemaining;
    handsLeft[opp] = oppCards;
    const w = oppBeliefWeight(oppCards.concat(oppPlayed), state, opp, opts);
    wTotal += w;
    if (solveEndgame(handsLeft, state.results, lead, turn, state.mano) === me) wWins += w;
  }
  return wTotal === 0 ? 0.5 : wWins / wTotal;
}

// Probabilidad de ganar la mano si juego una carta concreta ahora.
export function winProbAfterPlaying(state, me, card, samples = 160) {
  const opp = other(me);
  const oppCount = state.hands[opp].length;
  const myRemaining = state.hands[me].filter(
    (c) => !(c.rank === card.rank && c.suit === card.suit)
  );
  const known = state.hands[me].concat(allPlayed(state));
  const unknownDeck = removeCards(makeDeck(), known);

  // Determinar contexto de baza ANTES de jugar.
  const trick = state.tricks[state.tricks.length - 1];
  const iAmLeading = trick.plays.length === 0;

  const combos = consistentOppCombos(state, opp, unknownDeck, oppCount, playedBy(state, opp));
  let wins = 0;
  const n = oppCount === 0 ? 1 : samples;
  for (let i = 0; i < n; i++) {
    const oppCards =
      oppCount === 0
        ? []
        : combos
        ? combos[(Math.random() * combos.length) | 0]
        : shuffle(unknownDeck).slice(0, oppCount);
    const handsLeft = [];
    handsLeft[me] = myRemaining;
    handsLeft[opp] = oppCards;

    let lead, turn, results;
    results = state.results;
    if (iAmLeading) {
      lead = { player: me, card };
      turn = opp;
    } else {
      // el rival ya tiró la carta líder; mi carta cierra la baza
      const leadPlay = trick.plays[0];
      const cmp = compareCards(leadPlay.card, card);
      let res;
      if (cmp > 0) res = leadPlay.player;
      else if (cmp < 0) res = me;
      else res = 'parda';
      results = state.results.concat([res]);
      const hw = handWinner(results, state.mano);
      if (hw !== null) {
        if (hw === me) wins++;
        continue;
      }
      const leader = res === 'parda' ? state.mano : res;
      lead = null;
      turn = leader;
    }
    if (solveEndgame(handsLeft, results, lead, turn, state.mano) === me) wins++;
  }
  return wins / n;
}

// Elige la mejor carta para jugar (mayor probabilidad de ganar la mano).
export function chooseCard(state, me, samples = 140) {
  const candidates = state.hands[me];
  let best = null;
  let bestP = -1;
  const scored = [];
  for (const c of candidates) {
    const p = winProbAfterPlaying(state, me, c, samples);
    scored.push({ card: c, p });
    if (p > bestP) {
      bestP = p;
      best = c;
    }
  }
  return { card: best, winProb: bestP, scored };
}

// ---------- Análisis de envido (exacto por enumeración) ----------

function combinations(arr, k) {
  const res = [];
  const n = arr.length;
  const idx = [];
  const rec = (start, depth) => {
    if (depth === k) {
      res.push(idx.map((i) => arr[i]));
      return;
    }
    for (let i = start; i <= n - (k - depth); i++) {
      idx[depth] = i;
      rec(i + 1, depth + 1);
    }
  };
  rec(0, 0);
  return res;
}

// Si el rival QUISO el envido se revelaron los tantos. A partir de ahí, sus
// cartas ocultas no son al azar: deben ser consistentes con su tanto + lo que
// ya jugó. Devuelve la lista de combos posibles (o null = muestreo libre).
// Sólo cuando es barato y útil (<=2 ocultas) para no ralentizar nada.
export function consistentOppCombos(state, opp, unknownDeck, count, oppPlayed) {
  if (count < 1 || count > 2) return null;
  const env = state.envido;
  if (!env || !env.resolved || !env.shown) return null;
  const target = env.shown[opp];
  if (target == null) return null;
  const ok = combinations(unknownDeck, count).filter(
    (c) => envidoPoints(oppPlayed.concat(c)) === target
  );
  return ok.length ? ok : null; // sin consistentes (raro) => muestreo libre
}

export function envidoAnalysis(state, me, opts = {}) {
  const opp = other(me);
  const myFull = fullHand(state, me);
  const myPoints = envidoPoints(myFull);

  const oppPlayed = playedBy(state, opp);
  const oppHidden = 3 - oppPlayed.length;
  const known = myFull.concat(oppPlayed);
  const unknownDeck = removeCards(makeDeck(), known);

  const combos =
    oppHidden <= 0 ? [[]] : combinations(unknownDeck, oppHidden);

  // Si el rival CANTÓ el envido, su tanto está sesgado a ser alto: ponderamos
  // cada mano posible por la chance de que la cantara (más peso a tantos altos,
  // con un piso para los faroles). Así no se quiere con tantos marginales.
  const weight = opts.callerStrong
    ? (pts) => Math.max(0.12, Math.min(1, (pts - 17) / 10))
    : () => 1;

  let total = 0;
  let sum = 0;
  let wTotal = 0;
  let wWins = 0;
  let wTies = 0;
  const histogram = {};
  for (const combo of combos) {
    const oppFull = oppPlayed.concat(combo);
    const pts = envidoPoints(oppFull);
    const w = weight(pts);
    total++;
    sum += pts;
    wTotal += w;
    histogram[pts] = (histogram[pts] || 0) + 1;
    if (myPoints > pts) wWins += w;
    else if (myPoints === pts) wTies += w;
  }
  const iAmMano = state.mano === me;
  // En empate gana el mano.
  const pWin = wTotal === 0 ? 0.5 : (wWins + (iAmMano ? wTies : 0)) / wTotal;
  return {
    myPoints,
    pWin,
    mean: total ? sum / total : 0,
    total,
    histogram,
    iAmMano,
  };
}

// ---------- Política de decisión por valor esperado ----------

// Umbral de indiferencia "quiero": querer conviene si p >= (Vq-Vnq)/(2Vq).
function quieroThreshold(Vq, Vnq) {
  return (Vq - Vnq) / (2 * Vq);
}
const evQuiero = (p, Vq) => Vq * (2 * p - 1);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
// Rampa lineal: 0 si x<=lo, 1 si x>=hi.
const ramp = (x, lo, hi) => clamp01((x - lo) / (hi - lo));

// ---------- Estrategias mixtas (juego no explotable) ----------
//
// "Inexplotable" = que el rival no pueda sacar ventaja leyendo tus decisiones:
//  1) Cerca del umbral de indiferencia mezclamos quiero/no quiero al azar. Ahí
//     ambas valen casi lo mismo (no perdemos EV) pero dejamos de ser
//     predecibles, así que un corte fijo no se puede explotar.
//  2) Faroleamos (cantar/subir con manos flojas) a una frecuencia ACOTADA por
//     el ratio de indiferencia del rival: que pagarnos o no pagarnos le dé lo
//     mismo. Bluffear de más => nos pagan siempre; de menos => nos roban. El
//     equilibrio está en el medio.
//  3) Apostamos por valor con las manos fuertes, también de forma mezclada.
// No es el Nash exacto de todo el truco (eso requeriría resolver el árbol
// completo con CFR), pero acota fuertemente cuánto te pueden explotar.

function normalizeDist(dist) {
  const total = dist.reduce((s, d) => s + d.prob, 0) || 1;
  for (const d of dist) d.prob /= total;
  return dist.filter((d) => d.prob > 1e-6);
}

// Si bajarse (no quiero) entrega la partida al rival, no tiene sentido bajarse:
// se quita esa opción y se juega (quiero/subir), que al menos da chance.
function forcePlayIfFoldLoses(dist, state, caller, Vnq) {
  if (state.scores[caller] + Vnq < state.target) return dist;
  const kept = dist.filter((d) => d.action.type !== 'noquiero');
  const pool = kept.length ? kept : [{ action: { type: 'quiero' }, prob: 1, label: 'Quiero' }];
  return normalizeDist(pool);
}

// Distribución mixta para responder una apuesta (no quiero / quiero / subir).
export function responseDistribution(p, Vq, Vnq, raise) {
  const t = quieroThreshold(Vq, Vnq);
  const band = 0.07; // zona de mezcla alrededor del umbral
  let quiero = ramp(p, t - band, t + band);
  let no = 1 - quiero;

  let raiseProb = 0;
  let raiseAction = null;
  let raiseLabel = '';
  if (raise) {
    raiseAction = { type: 'call', bet: raise.bet };
    raiseLabel = labelLocal(raise.bet);
    const t2 = quieroThreshold(raise.Vq, raise.Vnq);
    // Subir por valor: manos muy fuertes (sale de la masa de "quiero").
    const valueRaise = ramp(p, 0.8, 0.95) * quiero;
    // Subir de farol: manos muy flojas; frecuencia acotada por t2 (balance).
    const bluffRaise = ramp(1 - p, 0.86, 1.0) * Math.min(0.5, t2) * no;
    raiseProb = valueRaise + bluffRaise;
    quiero -= valueRaise;
    no -= bluffRaise;
  }

  const dist = [];
  if (no > 1e-6) dist.push({ action: { type: 'noquiero' }, prob: no, label: 'No quiero' });
  if (quiero > 1e-6) dist.push({ action: { type: 'quiero' }, prob: quiero, label: 'Quiero' });
  if (raiseProb > 1e-6) dist.push({ action: raiseAction, prob: raiseProb, label: raiseLabel });
  return normalizeDist(dist);
}

function sampleDist(dist) {
  let r = Math.random();
  for (const d of dist) {
    if (r < d.prob) return d.action;
    r -= d.prob;
  }
  return dist[dist.length - 1].action;
}

// Elige acción: muestreo si mix, si no la más probable.
function chooseFromDist(dist, mix) {
  if (mix) return sampleDist(dist);
  return dist.slice().sort((a, b) => b.prob - a.prob)[0].action;
}

function describeMix(dist) {
  return (
    'Estrategia óptima (mixta): ' +
    dist.map((d) => `${d.label} ${Math.round(d.prob * 100)}%`).join(' · ')
  );
}

// Decisión binaria (cantar / no cantar) con frecuencia probTrue.
function gate(probTrue, mix) {
  return mix ? Math.random() < probTrue : probTrue >= 0.5;
}

// ---------- Valor de cantar vs esperar (rollouts Monte Carlo) ----------
//
// Para decidir si conviene cantar truco AHORA o esperar, comparamos el valor
// esperado de cada opción jugando la mano hasta el final muchas veces. En cada
// simulación muestreamos una mano posible del rival (creencia, no hacemos
// trampa) y ambos juegan con una política rápida. Esperar incluye, naturalmente,
// la opción de cantar más adelante (cuando haya más info o el rival reaccione).

const FAST_WIN = 10; // muestras MC de la política rápida dentro del rollout

// Tanto de envido rápido (sin enumerar): puntos de la mano completa.
function envidoQuick(state, player) {
  return envidoPoints(fullHand(state, player));
}

// Política rápida para usar DENTRO de los rollouts (no hace más rollouts).
function fastPolicy(state, player) {
  if (state.phase === 'envido-response') {
    const pts = envidoQuick(state, player);
    // El umbral real para querer el envido es bajo (basta ~25% de chance), así
    // que se quiere casi siempre salvo tanto muy bajo. Modelar bien esto evita
    // que el rollout sobrevalore cantar/farolear envido.
    const wantP = clamp01((pts - 15) / 8); // 15→0, 23→1
    return Math.random() < wantP ? { type: 'quiero' } : { type: 'noquiero' };
  }
  if (state.phase === 'truco-response') {
    const p = handWinProbability(state, player, FAST_WIN);
    const last = state.truco.chain[state.truco.chain.length - 1];
    const Vq = TRUCO_QUIERO[last];
    const Vnq = TRUCO_NOQUIERO[last];
    const next = { truco: 'retruco', retruco: 'valecuatro' }[last];
    const raise = next ? { bet: next, Vq: TRUCO_QUIERO[next], Vnq: TRUCO_NOQUIERO[next] } : null;
    return sampleDist(responseDistribution(p, Vq, Vnq, raise));
  }
  // phase 'play'
  if (state.results.length === 0 && !state.envido.resolved && state.envido.state === 'none') {
    if (envidoQuick(state, player) >= 26 && Math.random() < 0.7) {
      return { type: 'call', bet: 'envido' };
    }
  }
  const canCall = state.truco.chain.length === 0;
  const canRaise = state.truco.accepted && state.truco.canRaiseBy === player;
  const nextLevel = canRaise
    ? { truco: 'retruco', retruco: 'valecuatro' }[state.truco.chain[state.truco.chain.length - 1]]
    : null;
  if (canCall || (canRaise && nextLevel)) {
    const p = handWinProbability(state, player, FAST_WIN);
    const pv = clamp01((p - 0.7) / 0.2) * 0.7 + (p < 0.12 ? 0.1 : 0);
    if (Math.random() < pv) return { type: 'call', bet: canCall ? 'truco' : nextLevel };
  }
  // Carta: minimax exacto del final (más fuerte que una heurística).
  const trick = state.tricks[state.tricks.length - 1];
  const lead =
    trick.plays.length === 1
      ? { player: trick.plays[0].player, card: trick.plays[0].card }
      : null;
  return { type: 'play', card: bestEndgameCard(state.hands, state.results, lead, player, state.mano) };
}

// Valor esperado (en puntos netos de la mano) de tomar `firstAction` ahora y
// seguir con la política rápida. Promedia sobre manos posibles del rival.
// oppHands (opcional): manos del rival pre-sorteadas (para CRN). Si se pasan,
// se usan las MISMAS en cada opción comparada → la varianza del reparto se
// cancela en la diferencia de EV.
function rolloutEV(state, player, firstAction, R, oppHands = null) {
  const opp = other(player);
  let combos = null;
  let unknownDeck = null;
  let oppCount = 0;
  if (!oppHands) {
    const known = state.hands[player].concat(allPlayed(state));
    unknownDeck = removeCards(makeDeck(), known);
    oppCount = state.hands[opp].length;
    combos = consistentOppCombos(state, opp, unknownDeck, oppCount, playedBy(state, opp));
  }
  let sum = 0;
  for (let i = 0; i < R; i++) {
    const s = structuredClone(state);
    // creencia sobre el rival, consistente con el tanto que reveló (si lo hizo)
    s.hands[opp] = oppHands
      ? oppHands[i].slice()
      : combos
      ? combos[(Math.random() * combos.length) | 0].slice()
      : shuffle(unknownDeck).slice(0, oppCount);
    const base = s.scores.slice();
    let st = applyAction(s, firstAction);
    let guard = 0;
    while (st.phase !== 'hand-over' && st.phase !== 'game-over' && guard < 100) {
      const a = fastPolicy(st, st.phase === 'play' ? st.turn : st.responder);
      st = applyAction(st, a);
      guard++;
    }
    sum += st.scores[player] - base[player] - (st.scores[opp] - base[opp]);
  }
  return sum / R;
}

// Cantidad de rollouts según el presupuesto de muestras. Más alto = EV más
// estable (menos ruido Monte Carlo), a costa de tiempo. En la web (samples=220)
// da ~110; en simulaciones/tests (samples bajos) baja para no ser lento.
function rolloutCount(samples) {
  // CRN ya baja el ruido; mantenemos R moderado para que la web sea ágil
  // (~150 rollouts ≈ ~220 ms/jugada).
  return Math.max(12, Math.min(160, Math.round(samples / 2)));
}

// Pre-sortea R manos posibles del rival (respetando la deducción del envido).
// Sirve para CRN: usar las MISMAS manos al evaluar todas las opciones de una
// decisión, así la suerte del reparto se cancela en la comparación.
function sampleOppHands(state, player, R) {
  const opp = other(player);
  const known = state.hands[player].concat(allPlayed(state));
  const unknownDeck = removeCards(makeDeck(), known);
  const oppCount = state.hands[opp].length;
  const combos = consistentOppCombos(state, opp, unknownDeck, oppCount, playedBy(state, opp));
  const out = [];
  for (let i = 0; i < R; i++) {
    out.push(
      combos
        ? combos[(Math.random() * combos.length) | 0].slice()
        : shuffle(unknownDeck).slice(0, oppCount)
    );
  }
  return out;
}

// ---------- Recomendación principal ----------

export function recommend(state, player, opts = {}) {
  const mix = opts.mix ?? false;
  const samples = opts.samples ?? 300;

  if (state.phase === 'envido-response' && state.responder === player) {
    return decideEnvidoResponse(state, player, { mix });
  }
  if (state.phase === 'truco-response' && state.responder === player) {
    return decideTrucoResponse(state, player, { mix, samples });
  }
  if (state.phase === 'play' && state.turn === player) {
    return decidePlay(state, player, { mix, samples });
  }
  return { action: null, reasoning: ['No es el turno de este jugador.'] };
}

// ---------- Estrategia de envido por CFR (equilibrio, casi inexplotable) ----------
//
// La estrategia fue entrenada en el sub-juego de envido (contexto 0-0, falta=30)
// con CFR; ver train/envido_cfr.js. Es casi inexplotable y le gana mano a mano
// a la heurística por EV. Acá la mapeamos al estado del engine.
//
// Asientos del sub-juego: 0 = mano, 1 = pie. La clave del infoset es
// "tanto|hist/fase:asiento". El historial usa tokens E/R/F y un prefijo 'p' si
// el que abrió fue el pie (es decir, el mano dejó pasar el envido).
const ENV_TOK = { envido: 'E', realenvido: 'R', faltaenvido: 'F' };
const ENV_BET = { E: 'envido', R: 'realenvido', F: 'faltaenvido' };

function seatOf(state, p) {
  return state.mano === p ? 0 : 1;
}
function cfrEnvidoInfo(state, player) {
  const tanto = envidoPoints(state.hands[player].concat(playedBy(state, player)));
  if (state.phase === 'envido-response' && state.responder === player) {
    const chain = state.envido.chain;
    const tokens = chain.map((b) => ENV_TOK[b]).join('');
    const L = chain.length;
    const responderSeat = seatOf(state, player);
    const openerSeat = L % 2 === 1 ? (responderSeat === 0 ? 1 : 0) : responderSeat;
    const hist = (openerSeat === 1 ? 'p' : '') + tokens;
    const key = tanto + '|' + hist + '/respond:' + responderSeat;
    const acts = ['n', 'q', ...envidoNextOptionsLocal(chain).map((b) => ENV_TOK[b])];
    return { key, acts, kind: 'respond', tanto };
  }
  // open (cantar en 1ª mano)
  const seat = seatOf(state, player);
  const hist = seat === 0 ? '' : 'p';
  const key = tanto + '|' + hist + '/open:' + seat;
  return { key, acts: ['p', 'E', 'R', 'F'], kind: 'open', tanto };
}
// Devuelve la distribución de probabilidad CFR alineada a las acciones del nodo,
// o null si el infoset no existe (entonces se usa la heurística como respaldo).
function cfrEnvidoDist(state, player) {
  if (!ENVIDO_CFR) return null; // flag en config.js: false => heurística
  const info = cfrEnvidoInfo(state, player);
  const probs = ENVIDO_STRATEGY[info.key];
  if (!probs || probs.length !== info.acts.length) return null;
  return { ...info, probs };
}

function decideEnvidoResponse(state, player, { mix }) {
  const chain = state.envido.chain;
  const Vq = envidoChainValue(chain, state);
  const Vnq = envidoNoQuieroValue(chain, state);
  // ana sólo para mostrar (P(ganar), tanto); la DECISIÓN sale del CFR.
  const ana = envidoAnalysis(state, player, { callerStrong: true });
  const p = ana.pWin;
  const reasoning = [];
  reasoning.push(`Tu envido: ${ana.myPoints}. P(ganar) ≈ ${(p * 100).toFixed(0)}%${ana.iAmMano ? ', sos mano' : ''}.`);

  const cfr = cfrEnvidoDist(state, player);
  if (cfr) {
    // Mapea la distribución de equilibrio a acciones del engine.
    let dist = [];
    for (let i = 0; i < cfr.acts.length; i++) {
      const tok = cfr.acts[i];
      const prob = cfr.probs[i];
      if (prob <= 1e-6) continue;
      if (tok === 'n') dist.push({ action: { type: 'noquiero' }, prob, label: 'No quiero' });
      else if (tok === 'q') dist.push({ action: { type: 'quiero' }, prob, label: 'Quiero' });
      else {
        const bet = ENV_BET[tok];
        dist.push({ action: { type: 'call', bet }, prob, label: labelLocal(bet) });
      }
    }
    normalizeDist(dist);
    // Si bajarse entrega la partida, no se baja (ajuste por marcador).
    dist = forcePlayIfFoldLoses(dist, state, state.envido.caller, Vnq);
    reasoning.push('Respuesta por estrategia de equilibrio (CFR, casi inexplotable).');
    reasoning.push(describeMix(dist));
    const options = dist.map((d) => ({
      action: d.action,
      label: d.label,
      ev: d.action.type === 'noquiero' ? -Vnq : evQuiero(p, Vq),
    }));
    return { action: chooseFromDist(dist, mix), reasoning, winProb: null, envido: ana, distribution: dist, options };
  }

  // --- Respaldo heurístico (si el infoset no está en la tabla CFR) ---
  const nexts = envidoNextOptionsLocal(chain);
  let raise = null;
  if (nexts.length) {
    const needed = state.target - state.scores[player];
    const bet =
      (needed === 1 || p > 0.92) && nexts.includes('faltaenvido')
        ? 'faltaenvido'
        : nexts.includes('realenvido')
        ? 'realenvido'
        : nexts[0];
    const nc = chain.concat([bet]);
    raise = { bet, Vq: envidoChainValue(nc, state), Vnq: envidoNoQuieroValue(nc, state) };
  }
  let dist = responseDistribution(p, Vq, Vnq, raise);
  dist = forcePlayIfFoldLoses(dist, state, state.envido.caller, Vnq);
  reasoning.push(`Umbral para querer: ${(quieroThreshold(Vq, Vnq) * 100).toFixed(0)}%.`);
  reasoning.push(describeMix(dist));
  const options = dist.map((d) => ({
    action: d.action,
    label: d.label,
    ev: d.action.type === 'noquiero' ? -Vnq : evQuiero(p, Vq),
  }));
  return { action: chooseFromDist(dist, mix), reasoning, winProb: null, envido: ana, distribution: dist, options };
}

function decideTrucoResponse(state, player, { mix, samples }) {
  const reasoning = [];

  // "El envido es primero": en la 1ª, sin haber jugado carta, con el truco aún
  // no querido, y con envido muy fuerte, conviene cantarlo en respuesta al truco.
  if (
    state.results.length === 0 &&
    !state.envido.resolved &&
    !state.truco.accepted &&
    playedBy(state, player).length === 0
  ) {
    const ana = envidoAnalysis(state, player);
    if (ana.pWin > 0.75 && ana.myPoints >= 28) {
      reasoning.push(`Tenés ${ana.myPoints} de envido y va primero: conviene cantarlo.`);
      return { action: { type: 'call', bet: 'envido' }, reasoning, winProb: null, envido: ana };
    }
  }

  const lastBet = state.truco.chain[state.truco.chain.length - 1];
  // El rival cantó/recantó: nudge leve. El truco común se canta liberal (casi
  // sin sesgo); un recanto alto sí señala mano fuerte. La probabilidad cruda
  // (Monte Carlo) sigue siendo el driver principal.
  const center = { truco: 2, retruco: 4, valecuatro: 6 }[lastBet];
  const p = handWinProbability(state, player, samples, { callerStrong: true, center });
  const Vq = TRUCO_QUIERO[lastBet];
  const Vnq = TRUCO_NOQUIERO[lastBet];
  const t = quieroThreshold(Vq, Vnq);

  // Quiero vs no quiero: indiferencia exacta en p = t, con banda de mezcla.
  const band = 0.07;
  let quiero = clamp01(ramp(p, t - band, t + band));
  let no = 1 - quiero;
  const evQ = evQuiero(p, Vq);

  // Recanto (retruco/vale cuatro): por EV real, subir si EV(subir) > EV(quiero).
  const next = { truco: 'retruco', retruco: 'valecuatro' }[lastBet];
  let raiseProb = 0;
  let raiseAction = null;
  let evRaise = null;
  if (next) {
    raiseAction = { type: 'call', bet: next };
    const R = rolloutCount(samples);
    evRaise = rolloutEV(state, player, raiseAction, R);
    const valueRaise = ramp(evRaise - evQ, 0.02, 0.5) * quiero; // sube si rinde más que quiero
    const t2 = quieroThreshold(TRUCO_QUIERO[next], TRUCO_NOQUIERO[next]);
    const bluffRaise = ramp(1 - p, 0.86, 1.0) * Math.min(0.5, t2) * no; // farol acotado
    raiseProb = valueRaise + bluffRaise;
    quiero -= valueRaise;
    no -= bluffRaise;
  }

  let dist = [];
  if (no > 1e-6) dist.push({ action: { type: 'noquiero' }, prob: no, label: 'No quiero' });
  if (quiero > 1e-6) dist.push({ action: { type: 'quiero' }, prob: quiero, label: 'Quiero' });
  if (raiseProb > 1e-6) dist.push({ action: raiseAction, prob: raiseProb, label: labelLocal(next) });
  normalizeDist(dist);
  // Si bajarse entrega la partida, no se baja.
  dist = forcePlayIfFoldLoses(dist, state, state.truco.caller, Vnq);

  reasoning.push(`P(ganar la mano) ≈ ${(p * 100).toFixed(0)}%. Umbral para querer: ${(t * 100).toFixed(0)}%.`);
  if (evRaise !== null) {
    reasoning.push(`EV subir (${labelLocal(next)}) = ${evRaise.toFixed(2)} vs quiero = ${evQ.toFixed(2)}.`);
  }
  reasoning.push(describeMix(dist));

  const options = dist.map((d) => ({
    action: d.action,
    label: d.label,
    ev: d.action.type === 'noquiero' ? -Vnq : d.action.type === 'quiero' ? evQ : evRaise,
  }));
  return { action: chooseFromDist(dist, mix), reasoning, winProb: p, distribution: dist, options };
}

function decidePlay(state, player, { mix, samples }) {
  const reasoning = [];
  const R = rolloutCount(samples);
  const choice = chooseCard(state, player, Math.max(40, Math.round(samples / 2)));
  const bestCard = choice.card;

  // CRN: pre-sorteamos las manos del rival UNA vez y las reusamos en todas las
  // opciones (cantar/esperar) → la suerte del reparto se cancela en la
  // comparación, así la decisión es menos ruidosa sin más cómputo.
  const oppHands = sampleOppHands(state, player, R);

  // "Esperar" = jugar la mejor carta y seguir con la política (conserva la
  // opción de cantar después). Se calcula una sola vez y se reusa.
  let evWaitCache = null;
  const evWait = () => {
    if (evWaitCache === null)
      evWaitCache = rolloutEV(state, player, { type: 'play', card: bestCard }, R, oppHands);
    return evWaitCache;
  };

  // Decisión de cantar X por EV: compara cantar ahora vs esperar. Mezcla cerca
  // de la indiferencia + farol acotado con mano floja (mismo criterio para todo).
  const cantaProbFor = (bet, p) => {
    const evCanta = rolloutEV(state, player, { type: 'call', bet }, R, oppHands);
    const w = evWait();
    // Margen: exige una ventaja real de EV antes de cantar (juego menos
    // ofensivo). Pendiente más suave + farol más chico.
    const margin = 0.08;
    let prob = 1 / (1 + Math.exp(-2.2 * (evCanta - w - margin)));
    const bluff = ramp(1 - p, 0.92, 1.0) * 0.06;
    prob = Math.min(0.9, clamp01(Math.max(prob, bluff)));
    return { prob, evCanta, evWait: w };
  };

  // 1) Envido (sólo en la 1ª, si nadie cantó y el truco no fue querido).
  if (
    state.results.length === 0 &&
    !state.envido.resolved &&
    state.envido.state === 'none' &&
    !state.truco.accepted
  ) {
    const cfr = cfrEnvidoDist(state, player); // nodo "abrir"
    if (cfr) {
      // Decisión por estrategia de equilibrio (CFR): cantar/pasar y con qué.
      const PASS = { type: 'pass' };
      const dist = [];
      for (let i = 0; i < cfr.acts.length; i++) {
        const tok = cfr.acts[i];
        const prob = cfr.probs[i];
        if (prob <= 1e-6) continue;
        if (tok === 'p') dist.push({ action: PASS, prob, label: 'No cantar' });
        else dist.push({ action: { type: 'call', bet: ENV_BET[tok] }, prob, label: labelLocal(ENV_BET[tok]) });
      }
      normalizeDist(dist);
      const chosen = chooseFromDist(dist, mix);
      if (chosen.type === 'call') {
        let bet = chosen.bet;
        // A 1 del triunfo, la falta arriesga 1 y alcanza para ganar: mejor falta.
        if (state.target - state.scores[player] === 1) bet = 'faltaenvido';
        reasoning.push('Envido por estrategia de equilibrio (CFR, casi inexplotable).');
        reasoning.push(describeMix(dist));
        const sp = dist.find((d) => d.action === chosen);
        return { action: { type: 'call', bet }, reasoning, singProb: sp ? sp.prob : null };
      }
      // chosen = pasar: no canta envido; sigue al truco / carta.
    } else {
      // --- Respaldo heurístico (por EV con rollouts) ---
      const ana = envidoAnalysis(state, player);
      const needed = state.target - state.scores[player];
      const bet = needed === 1 ? 'faltaenvido' : ana.pWin >= 0.85 ? 'realenvido' : 'envido';
      const { prob, evCanta, evWait: w } = cantaProbFor(bet, ana.pWin);
      reasoning.push(`Envido: tenés ${ana.myPoints}, P(ganar) ≈ ${(ana.pWin * 100).toFixed(0)}%.`);
      reasoning.push(`EV cantar ${labelLocal(bet)} = ${evCanta.toFixed(2)} vs esperar = ${w.toFixed(2)} → cantar ${(prob * 100).toFixed(0)}%.`);
      if (gate(prob, mix)) {
        return { action: { type: 'call', bet }, reasoning, envido: ana, singProb: prob };
      }
    }
  }

  // 2) Truco: cantar/subir comparando EV(cantar ahora) vs EV(esperar).
  const p = handWinProbability(state, player, samples);
  const trucoState = state.truco;
  const canCallTruco = trucoState.chain.length === 0;
  const canRaise = trucoState.accepted && trucoState.canRaiseBy === player;
  const nextLevel = canRaise
    ? { truco: 'retruco', retruco: 'valecuatro' }[trucoState.chain[trucoState.chain.length - 1]]
    : null;

  if (canCallTruco || (canRaise && nextLevel)) {
    const bet = canCallTruco ? 'truco' : nextLevel;
    const { prob, evCanta, evWait: w } = cantaProbFor(bet, p);
    reasoning.push(`P(ganar la mano) ≈ ${(p * 100).toFixed(0)}%.`);
    reasoning.push(`EV cantar ${labelLocal(bet)} = ${evCanta.toFixed(2)} vs esperar = ${w.toFixed(2)} → cantar ${(prob * 100).toFixed(0)}%.`);
    if (gate(prob, mix)) {
      return { action: { type: 'call', bet }, reasoning, winProb: p, singProb: prob };
    }
  }

  // 3) Jugar la mejor carta.
  reasoning.push(`Mejor carta: ${bestCard.rank} de ${bestCard.suit} (P(ganar) ≈ ${(choice.winProb * 100).toFixed(0)}%).`);
  reasoning.push(
    'Opciones: ' +
      choice.scored.map((s) => `${s.card.rank}${s.card.suit[0]}=${(s.p * 100).toFixed(0)}%`).join(', ')
  );
  return { action: { type: 'play', card: bestCard }, reasoning, winProb: choice.winProb };
}

// helpers locales (duplican lo del engine para no exponer internos)
function envidoNextOptionsLocal(chain) {
  if (chain.includes('faltaenvido')) return [];
  const opts = [];
  const hasReal = chain.includes('realenvido');
  const c = chain.filter((b) => b === 'envido').length;
  // Misma regla que el engine: envido → (envido) → real envido → falta envido.
  if (!hasReal && c < 2) opts.push('envido');
  if (!hasReal) opts.push('realenvido');
  opts.push('faltaenvido');
  return opts;
}
function labelLocal(bet) {
  return {
    envido: 'Envido',
    realenvido: 'Real Envido',
    faltaenvido: 'Falta Envido',
    truco: 'Truco',
    retruco: 'Retruco',
    valecuatro: 'Vale Cuatro',
  }[bet];
}
