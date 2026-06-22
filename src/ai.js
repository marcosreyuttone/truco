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

// ---------- Probabilidad de ganar la mano (Monte Carlo) ----------

export function handWinProbability(state, me, samples = 300) {
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

  let wins = 0;
  for (let i = 0; i < samples; i++) {
    const oppCards = shuffle(unknownDeck).slice(0, oppCount);
    const { lead, turn } = trickContext(state);
    const handsLeft = [];
    handsLeft[me] = myRemaining;
    handsLeft[opp] = oppCards;
    if (solveEndgame(handsLeft, state.results, lead, turn, state.mano) === me) wins++;
  }
  return wins / samples;
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

  let wins = 0;
  const n = oppCount === 0 ? 1 : samples;
  for (let i = 0; i < n; i++) {
    const oppCards = oppCount === 0 ? [] : shuffle(unknownDeck).slice(0, oppCount);
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

const FAST_WIN = 6; // muestras MC de la política rápida dentro del rollout

// Tanto de envido rápido (sin enumerar): puntos de la mano completa.
function envidoQuick(state, player) {
  return envidoPoints(fullHand(state, player));
}

// Elección de carta rápida (heurística, sin búsqueda): si respondo, la menor
// que gane (si no, la más baja); si lidero, la más alta.
function fastCard(state, player) {
  const hand = state.hands[player];
  const trick = state.tricks[state.tricks.length - 1];
  if (trick.plays.length === 1 && trick.plays[0].player !== player) {
    const oppCard = trick.plays[0].card;
    const winners = hand
      .filter((c) => compareCards(c, oppCard) > 0)
      .sort((a, b) => trucoPower(a) - trucoPower(b));
    if (winners.length) return winners[0];
    return hand.slice().sort((a, b) => trucoPower(a) - trucoPower(b))[0];
  }
  return hand.slice().sort((a, b) => trucoPower(b) - trucoPower(a))[0];
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
  return { type: 'play', card: fastCard(state, player) };
}

// Valor esperado (en puntos netos de la mano) de tomar `firstAction` ahora y
// seguir con la política rápida. Promedia sobre manos posibles del rival.
function rolloutEV(state, player, firstAction, R) {
  const opp = other(player);
  const known = state.hands[player].concat(allPlayed(state));
  const unknownDeck = removeCards(makeDeck(), known);
  const oppCount = state.hands[opp].length;
  let sum = 0;
  for (let i = 0; i < R; i++) {
    const s = structuredClone(state);
    s.hands[opp] = shuffle(unknownDeck).slice(0, oppCount); // creencia sobre el rival
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
  return Math.max(10, Math.min(120, Math.round(samples / 2)));
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

function decideEnvidoResponse(state, player, { mix }) {
  // El rival cantó: asumimos que su tanto está sesgado a ser alto.
  const ana = envidoAnalysis(state, player, { callerStrong: true });
  const chain = state.envido.chain;
  const Vq = envidoChainValue(chain, state);
  const Vnq = envidoNoQuieroValue(chain, state);
  const p = ana.pWin;

  const reasoning = [];
  reasoning.push(`Tu envido: ${ana.myPoints}. P(ganar) ≈ ${(p * 100).toFixed(0)}% (asumiendo que el rival cantó con buen tanto)${ana.iAmMano ? ', sos mano' : ''}.`);

  const nexts = envidoNextOptionsLocal(chain);
  let raise = null;
  if (nexts.length) {
    // A 1 del triunfo, o con tanto casi seguro, escalar a la falta (arriesga
    // menos y cierra la partida); si no, al real envido.
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
  // Si bajarse entrega la partida, no se baja.
  dist = forcePlayIfFoldLoses(dist, state, state.envido.caller, Vnq);
  reasoning.push(`Umbral para querer: ${(quieroThreshold(Vq, Vnq) * 100).toFixed(0)}%.`);
  reasoning.push(describeMix(dist));

  const options = dist.map((d) => ({
    action: d.action,
    label: d.label,
    ev: d.action.type === 'noquiero' ? -Vnq : evQuiero(p, Vq),
  }));
  return {
    action: chooseFromDist(dist, mix),
    reasoning,
    winProb: null,
    envido: ana,
    distribution: dist,
    options,
  };
}

function decideTrucoResponse(state, player, { mix, samples }) {
  const reasoning = [];

  // "El envido es primero": en la 1ª, sin haber jugado carta todavía y con
  // envido muy fuerte, conviene cantarlo en respuesta al truco.
  if (state.results.length === 0 && !state.envido.resolved && playedBy(state, player).length === 0) {
    const ana = envidoAnalysis(state, player);
    if (ana.pWin > 0.75 && ana.myPoints >= 28) {
      reasoning.push(`Tenés ${ana.myPoints} de envido y va primero: conviene cantarlo.`);
      return { action: { type: 'call', bet: 'envido' }, reasoning, winProb: null, envido: ana };
    }
  }

  const p = handWinProbability(state, player, samples);
  const lastBet = state.truco.chain[state.truco.chain.length - 1];
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

  // "Esperar" = jugar la mejor carta y seguir con la política (conserva la
  // opción de cantar después). Se calcula una sola vez y se reusa.
  let evWaitCache = null;
  const evWait = () => {
    if (evWaitCache === null) evWaitCache = rolloutEV(state, player, { type: 'play', card: bestCard }, R);
    return evWaitCache;
  };

  // Decisión de cantar X por EV: compara cantar ahora vs esperar. Mezcla cerca
  // de la indiferencia + farol acotado con mano floja (mismo criterio para todo).
  const cantaProbFor = (bet, p) => {
    const evCanta = rolloutEV(state, player, { type: 'call', bet }, R);
    const w = evWait();
    let prob = 1 / (1 + Math.exp(-2.5 * (evCanta - w)));
    const bluff = ramp(1 - p, 0.9, 1.0) * 0.1;
    prob = Math.min(0.92, clamp01(Math.max(prob, bluff)));
    return { prob, evCanta, evWait: w };
  };

  // 1) Envido (sólo en la 1ª, si nadie cantó) — por EV, igual que el truco.
  if (state.results.length === 0 && !state.envido.resolved && state.envido.state === 'none') {
    const ana = envidoAnalysis(state, player);
    // A 1 punto del triunfo, la falta envido arriesga 1 (no 2) y alcanza para
    // ganar la partida: conviene cantar falta en vez de envido.
    const needed = state.target - state.scores[player];
    const bet = needed === 1 ? 'faltaenvido' : ana.pWin >= 0.85 ? 'realenvido' : 'envido';
    const { prob, evCanta, evWait: w } = cantaProbFor(bet, ana.pWin);
    reasoning.push(`Envido: tenés ${ana.myPoints}, P(ganar) ≈ ${(ana.pWin * 100).toFixed(0)}%.`);
    reasoning.push(`EV cantar ${labelLocal(bet)} = ${evCanta.toFixed(2)} vs esperar = ${w.toFixed(2)} → cantar ${(prob * 100).toFixed(0)}%.`);
    if (gate(prob, mix)) {
      return { action: { type: 'call', bet }, reasoning, envido: ana, singProb: prob };
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
