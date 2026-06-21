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
} from './cards.js';
import {
  handWinner,
  envidoChainValue,
  envidoNoQuieroValue,
  faltaValue,
  TRUCO_QUIERO,
  TRUCO_NOQUIERO,
  other,
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

export function envidoAnalysis(state, me) {
  const opp = other(me);
  const myFull = fullHand(state, me);
  const myPoints = envidoPoints(myFull);

  const oppPlayed = playedBy(state, opp);
  const oppHidden = 3 - oppPlayed.length;
  const known = myFull.concat(oppPlayed);
  const unknownDeck = removeCards(makeDeck(), known);

  const combos =
    oppHidden <= 0 ? [[]] : combinations(unknownDeck, oppHidden);

  let total = 0;
  let wins = 0;
  let ties = 0;
  let sum = 0;
  const histogram = {};
  for (const combo of combos) {
    const oppFull = oppPlayed.concat(combo);
    const pts = envidoPoints(oppFull);
    total++;
    sum += pts;
    histogram[pts] = (histogram[pts] || 0) + 1;
    if (myPoints > pts) wins++;
    else if (myPoints === pts) ties++;
  }
  const iAmMano = state.mano === me;
  // En empate gana el mano.
  const pWin = total === 0 ? 0.5 : (wins + (iAmMano ? ties : 0)) / total;
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

// Umbral de "quiero" para una apuesta tipo truco: aceptar si p >= (Vq-Vnq)/(2Vq).
function quieroThreshold(Vq, Vnq) {
  return (Vq - Vnq) / (2 * Vq);
}

// EV (en puntos) de aceptar una apuesta de valor Vq con prob de ganar p.
const evQuiero = (p, Vq) => Vq * (2 * p - 1);

// Recomendación principal. Devuelve { action, reasoning, winProb/envido, mix }.
// opts.mix=true permite jugadas mixtas (bluff); opts.samples controla MC.
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
  const ana = envidoAnalysis(state, player);
  const chain = state.envido.chain;
  const Vq = envidoChainValue(chain, state);
  const Vnq = envidoNoQuieroValue(chain, state);
  const p = ana.pWin;

  const reasoning = [];
  reasoning.push(`Tu envido: ${ana.myPoints}. Rival promedio ≈ ${ana.mean.toFixed(1)}.`);
  reasoning.push(`P(ganar el envido) ≈ ${(p * 100).toFixed(0)}%${ana.iAmMano ? ' (sos mano, ganás los empates)' : ''}.`);

  const options = [];
  options.push({ action: { type: 'quiero' }, ev: evQuiero(p, Vq), label: `Quiero (${Vq})` });
  options.push({ action: { type: 'noquiero' }, ev: -Vnq, label: `No quiero (-${Vnq})` });

  // Subir (re-cantar) si me deja mejor.
  for (const bet of envidoNextOptionsLocal(chain)) {
    const newChain = chain.concat([bet]);
    const Vq2 = envidoChainValue(newChain, state);
    const Vnq2 = envidoNoQuieroValue(newChain, state);
    // El rival acepta si p <= (Vq2+Vnq2)/(2 Vq2) (yo fuerte => rival se baja).
    const oppFolds = p > (Vq2 + Vnq2) / (2 * Vq2);
    const ev = oppFolds ? Vnq2 : evQuiero(p, Vq2);
    options.push({
      action: { type: 'call', bet },
      ev,
      label: `${labelLocal(bet)} (esperás ${ev.toFixed(2)})`,
    });
  }

  return pick(options, reasoning, { mix, p, kind: 'envido' });
}

function decideTrucoResponse(state, player, { mix, samples }) {
  const reasoning = [];
  const options = [];

  // "El envido es primero": si estamos en la 1ª y no se resolvió, podemos
  // contestar con envido cuando nos conviene.
  if (state.results.length === 0 && !state.envido.resolved) {
    const ana = envidoAnalysis(state, player);
    if (ana.pWin > 0.6 && ana.myPoints >= 27) {
      reasoning.push(`Tenés ${ana.myPoints} de envido y va primero: conviene cantarlo.`);
      return {
        action: { type: 'call', bet: 'envido' },
        reasoning,
        winProb: null,
        envido: ana,
      };
    }
  }

  const p = handWinProbability(state, player, samples);
  const lastBet = state.truco.chain[state.truco.chain.length - 1];
  const Vq = TRUCO_QUIERO[lastBet];
  const Vnq = TRUCO_NOQUIERO[lastBet];

  reasoning.push(`P(ganar la mano) ≈ ${(p * 100).toFixed(0)}%.`);
  reasoning.push(`Umbral para querer el ${lastBet}: ${(quieroThreshold(Vq, Vnq) * 100).toFixed(0)}%.`);

  options.push({ action: { type: 'quiero' }, ev: evQuiero(p, Vq), label: `Quiero (${Vq})` });
  options.push({ action: { type: 'noquiero' }, ev: -Vnq, label: `No quiero (-${Vnq})` });

  const next = { truco: 'retruco', retruco: 'valecuatro' }[lastBet];
  if (next) {
    const Vq2 = TRUCO_QUIERO[next];
    const Vnq2 = TRUCO_NOQUIERO[next];
    const oppFolds = p > (Vq2 + Vnq2) / (2 * Vq2);
    const ev = oppFolds ? Vnq2 : evQuiero(p, Vq2);
    options.push({ action: { type: 'call', bet: next }, ev, label: `${labelLocal(next)} (${ev.toFixed(2)})` });
  }

  return pick(options, reasoning, { mix, p, kind: 'truco', Vq, Vnq });
}

function decidePlay(state, player, { mix, samples }) {
  const reasoning = [];

  // 1) ¿Conviene cantar envido? (sólo en la 1ª, si nadie lo cantó)
  if (state.results.length === 0 && !state.envido.resolved && state.envido.state === 'none') {
    const ana = envidoAnalysis(state, player);
    const myScore = state.scores[player];
    // EV de cantar envido (rival decide querer según su prob ≈ 1-p).
    const Vq = 2;
    const oppFolds = ana.pWin > 0.5; // si soy favorito, suele bajarse
    const evCantar = oppFolds ? 1 : evQuiero(ana.pWin, Vq);
    const wantEnvido = ana.pWin >= 0.58 || ana.myPoints >= 28;
    const bluff = mix && Math.random() < 0.12 && ana.myPoints <= 22;
    if (wantEnvido || bluff) {
      reasoning.push(
        `Envido: tenés ${ana.myPoints}, P(ganar) ≈ ${(ana.pWin * 100).toFixed(0)}%.` +
          (bluff ? ' (bluff de envido)' : '')
      );
      const bet = ana.myPoints >= 31 ? 'realenvido' : 'envido';
      return { action: { type: 'call', bet }, reasoning, envido: ana };
    }
  }

  // 2) ¿Conviene cantar / subir el truco?
  const p = handWinProbability(state, player, samples);
  const trucoState = state.truco;
  const canCallTruco = trucoState.chain.length === 0;
  const canRaise = trucoState.accepted && trucoState.canRaiseBy === player;
  const next = canRaise
    ? { truco: 'retruco', retruco: 'valecuatro' }[trucoState.chain[trucoState.chain.length - 1]]
    : null;

  if (canCallTruco || (canRaise && next)) {
    const bet = canCallTruco ? 'truco' : next;
    const Vq = TRUCO_QUIERO[bet];
    const Vnq = TRUCO_NOQUIERO[bet];
    const curStake = state.handStake;
    const oppFolds = p > (Vq + Vnq) / (2 * Vq); // rival débil se baja
    const evCantar = oppFolds ? curStake + Vnq : evQuiero(p, Vq);
    const evCallar = evQuiero(p, curStake);
    const bluff = mix && Math.random() < 0.15 && p < 0.4 && state.hands[player].length <= 1;
    if (evCantar > evCallar + 1e-9 || bluff) {
      reasoning.push(
        `P(ganar la mano) ≈ ${(p * 100).toFixed(0)}%. Cantar ${bet} rinde ${evCantar.toFixed(2)} vs ${evCallar.toFixed(2)} de no cantar.` +
          (bluff ? ' (bluff de truco)' : '')
      );
      return { action: { type: 'call', bet }, reasoning, winProb: p };
    }
  }

  // 3) Jugar la mejor carta.
  const { card, winProb, scored } = chooseCard(state, player, Math.max(80, samples / 2));
  reasoning.push(
    `Mejor carta: ${card.rank} de ${card.suit} (P(ganar) ≈ ${(winProb * 100).toFixed(0)}%).`
  );
  reasoning.push(
    'Opciones: ' +
      scored
        .map((s) => `${s.card.rank}${s.card.suit[0]}=${(s.p * 100).toFixed(0)}%`)
        .join(', ')
  );
  return { action: { type: 'play', card }, reasoning, winProb };
}

// Elige la opción de mayor EV; con mix, agrega bluff/indiferencia.
function pick(options, reasoning, ctx) {
  options.sort((a, b) => b.ev - a.ev);
  reasoning.push('EV: ' + options.map((o) => `${o.label}=${o.ev.toFixed(2)}`).join(' | '));
  let chosen = options[0];

  if (ctx.mix) {
    // Si las dos mejores están parejas, randomizar (estrategia mixta).
    if (options.length >= 2 && Math.abs(options[0].ev - options[1].ev) < 0.2) {
      chosen = Math.random() < 0.5 ? options[0] : options[1];
      reasoning.push('Opciones parejas: se juega mixto.');
    }
  }
  return { action: chosen.action, reasoning, winProb: ctx.p, options };
}

// helpers locales (duplican lo del engine para no exponer internos)
function envidoNextOptionsLocal(chain) {
  if (chain.includes('faltaenvido')) return [];
  const opts = [];
  const c = chain.filter((b) => b === 'envido').length;
  if (c < 2) opts.push('envido');
  if (!chain.includes('realenvido')) opts.push('realenvido');
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
