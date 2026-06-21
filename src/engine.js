// Motor del Truco argentino 1v1 (mano a mano), a 30 puntos.
//
// El estado es un objeto plano y todas las transiciones son funciones puras
// (devuelven un estado nuevo). Eso permite a la IA clonar el estado y simular
// jugadas sin efectos colaterales.
//
// Acciones posibles (sobre state.turn / state.responder):
//   { type: 'play', card }
//   { type: 'call', bet }   bet ∈ envido|realenvido|faltaenvido|truco|retruco|valecuatro
//   { type: 'quiero' }
//   { type: 'noquiero' }
//   { type: 'mazo' }        irse al mazo

import {
  makeDeck,
  shuffle,
  compareCards,
  envidoPoints,
  cardLabel,
} from './cards.js';

export const TARGET = 30;
const other = (p) => (p === 0 ? 1 : 0);
const clone = (s) => structuredClone(s);

// ---------- Valores de las apuestas ----------

const TRUCO_QUIERO = { truco: 2, retruco: 3, valecuatro: 4 };
const TRUCO_NOQUIERO = { truco: 1, retruco: 2, valecuatro: 3 };
const TRUCO_NEXT = { '': 'truco', truco: 'retruco', retruco: 'valecuatro' };

function faltaValue(state) {
  return Math.max(1, state.target - Math.max(...state.scores));
}

function envidoChainValue(chain, state) {
  if (chain.includes('faltaenvido')) return faltaValue(state);
  let v = 0;
  for (const b of chain) {
    if (b === 'envido') v += 2;
    else if (b === 'realenvido') v += 3;
  }
  return v;
}

function envidoNoQuieroValue(chain, state) {
  const prefix = chain.slice(0, -1);
  return Math.max(1, envidoChainValue(prefix, state));
}

// Próximos cantos de envido permitidos dada la cadena actual.
function envidoNextOptions(chain) {
  if (chain.includes('faltaenvido')) return [];
  const opts = [];
  const envidoCount = chain.filter((b) => b === 'envido').length;
  if (envidoCount < 2) opts.push('envido');
  if (!chain.includes('realenvido')) opts.push('realenvido');
  opts.push('faltaenvido');
  return opts;
}

// ---------- Creación de mano / partida ----------

export function newGame(target = TARGET) {
  // El dealer reparte; el otro es "mano" (juega primero y gana las pardas
  // a la hora de definir la mano). Arranca repartiendo el jugador 1
  // (la máquina o el rival), así el humano (jugador 0) es mano en la 1ª.
  return dealHand({
    target,
    scores: [0, 0],
    dealer: 1,
  });
}

export function dealHand(prev, rng = Math.random) {
  const deck = shuffle(makeDeck(), rng);
  const hands = [deck.slice(0, 3), deck.slice(3, 6)];
  return createHandState({
    target: prev.target,
    scores: prev.scores.slice(),
    dealer: prev.dealer,
    hands,
  });
}

// Construye el estado de una mano a partir de las manos repartidas.
export function createHandState({ target, scores, dealer, hands }) {
  const mano = other(dealer);
  return {
    target,
    scores: scores.slice(),
    dealer,
    mano,
    hands: hands.map((h) => h.slice()),
    tricks: [{ plays: [] }], // baza en curso
    results: [], // resultado de cada baza: 0 | 1 | 'parda'
    turn: mano,
    phase: 'play',
    responder: null,
    envido: { chain: [], state: 'none', caller: null, resolved: false },
    truco: { chain: [], accepted: false, caller: null, canRaiseBy: null },
    suspendedTruco: false,
    handStake: 1, // cuánto vale la mano por truco (1 si nadie cantó)
    log: [],
    handWinner: null,
    handPoints: 0,
    winner: null, // ganador de la partida
  };
}

function completedTricks(state) {
  return state.results.length;
}

function pushLog(state, msg) {
  state.log.push(msg);
}

// ---------- Acciones legales ----------

export function legalActions(state) {
  if (state.phase === 'game-over' || state.phase === 'hand-over') return [];

  const actions = [];

  if (state.phase === 'envido-response') {
    const p = state.responder;
    actions.push({ type: 'quiero' });
    actions.push({ type: 'noquiero' });
    for (const bet of envidoNextOptions(state.envido.chain)) {
      actions.push({ type: 'call', bet });
    }
    return tag(actions, p);
  }

  if (state.phase === 'truco-response') {
    const p = state.responder;
    actions.push({ type: 'quiero' });
    actions.push({ type: 'noquiero' });
    const next = TRUCO_NEXT[state.truco.chain[state.truco.chain.length - 1] || ''];
    if (next) actions.push({ type: 'call', bet: next });
    // "El envido es primero": en la primera baza se puede contestar el truco
    // cantando envido si todavía no se jugó.
    if (completedTricks(state) === 0 && !state.envido.resolved) {
      actions.push({ type: 'call', bet: 'envido' });
      actions.push({ type: 'call', bet: 'realenvido' });
      actions.push({ type: 'call', bet: 'faltaenvido' });
    }
    return tag(actions, p);
  }

  // phase === 'play'
  const p = state.turn;
  for (const card of state.hands[p]) {
    actions.push({ type: 'play', card });
  }
  // Envido: sólo en la primera baza, si no se resolvió aún.
  if (completedTricks(state) === 0 && !state.envido.resolved && state.envido.state === 'none') {
    actions.push({ type: 'call', bet: 'envido' });
    actions.push({ type: 'call', bet: 'realenvido' });
    actions.push({ type: 'call', bet: 'faltaenvido' });
  }
  // Truco: puede cantarlo quien tenga el "derecho" (nadie cantó, o sos el
  // que dijo el último quiero).
  if (state.truco.chain.length === 0) {
    actions.push({ type: 'call', bet: 'truco' });
  } else if (state.truco.accepted && state.truco.canRaiseBy === p) {
    const next = TRUCO_NEXT[state.truco.chain[state.truco.chain.length - 1]];
    if (next) actions.push({ type: 'call', bet: next });
  }
  actions.push({ type: 'mazo' });
  return tag(actions, p);
}

function tag(actions, player) {
  return actions.map((a) => ({ ...a, player }));
}

// ---------- Aplicar acción ----------

export function applyAction(state, action) {
  const s = clone(state);
  switch (action.type) {
    case 'play':
      return applyPlay(s, action.card);
    case 'call':
      return applyCall(s, action.bet);
    case 'quiero':
      return applyQuiero(s);
    case 'noquiero':
      return applyNoQuiero(s);
    case 'mazo':
      return applyMazo(s);
    default:
      throw new Error(`Acción desconocida: ${action.type}`);
  }
}

function applyPlay(s, card) {
  const p = s.turn;
  const idx = s.hands[p].findIndex(
    (c) => c.rank === card.rank && c.suit === card.suit
  );
  if (idx < 0) throw new Error('Carta no está en la mano');
  s.hands[p].splice(idx, 1);
  const trick = s.tricks[s.tricks.length - 1];
  trick.plays.push({ player: p, card });
  pushLog(s, `J${p} juega ${cardLabel(card)}`);

  if (trick.plays.length === 2) {
    return resolveTrick(s);
  }
  s.turn = other(p);
  return s;
}

function resolveTrick(s) {
  const trick = s.tricks[s.tricks.length - 1];
  const [a, b] = trick.plays;
  const cmp = compareCards(a.card, b.card);
  let result;
  if (cmp > 0) result = a.player;
  else if (cmp < 0) result = b.player;
  else result = 'parda';
  trick.winner = result;
  s.results.push(result);
  pushLog(
    s,
    result === 'parda' ? 'Baza parda' : `Gana la baza J${result}`
  );

  const hw = handWinner(s.results, s.mano);
  if (hw !== null) {
    return endHand(s, hw, s.handStake);
  }

  // Próxima baza: lidera el ganador; si fue parda, lidera el mano.
  const leader = result === 'parda' ? s.mano : result;
  s.tricks.push({ plays: [] });
  s.turn = leader;
  s.phase = 'play';
  return s;
}

// Determina el ganador de la mano según los resultados de las bazas.
// Devuelve 0 | 1 | null (indefinido todavía).
export function handWinner(results, mano) {
  const wins = (pl) => results.filter((r) => r === pl).length;
  if (wins(0) >= 2) return 0;
  if (wins(1) >= 2) return 1;

  const P = 'parda';
  if (results.length >= 1 && results[0] === P) {
    for (let i = 1; i < results.length; i++) {
      if (results[i] !== P) return results[i];
    }
    if (results.length === 3) return mano; // todas pardas: gana el mano
    return null;
  }

  const f = results[0];
  if (f === 0 || f === 1) {
    if (results.length >= 2) {
      if (results[1] === P) return f; // ganó la 1ª, parda la 2ª
      if (results[1] === f) return f;
      // 1-1: define la tercera (parda => gana quien ganó la primera)
      if (results.length >= 3) {
        return results[2] === P ? f : results[2];
      }
    }
  }
  return null;
}

function applyCall(s, bet) {
  if (bet === 'truco' || bet === 'retruco' || bet === 'valecuatro') {
    return callTruco(s, bet);
  }
  return callEnvido(s, bet);
}

function callEnvido(s, bet) {
  const caller = s.phase === 'play' ? s.turn : s.responder;
  s.envido.chain.push(bet);
  s.envido.caller = caller;
  s.envido.state = 'pending';
  // Si veníamos de una respuesta de truco => "envido primero".
  if (s.phase === 'truco-response') {
    s.suspendedTruco = true;
  }
  s.phase = 'envido-response';
  s.responder = other(caller);
  pushLog(s, `J${caller} canta ${labelBet(bet)}`);
  return s;
}

function callTruco(s, bet) {
  const caller = s.phase === 'play' ? s.turn : s.responder;
  s.truco.chain.push(bet);
  s.truco.caller = caller;
  s.phase = 'truco-response';
  s.responder = other(caller);
  pushLog(s, `J${caller} canta ${labelBet(bet)}`);
  return s;
}

function applyQuiero(s) {
  const who = s.responder;
  if (s.phase === 'envido-response') {
    const value = envidoChainValue(s.envido.chain, s);
    const pts0 = envidoPoints(handFull(s, 0));
    const pts1 = envidoPoints(handFull(s, 1));
    let winner;
    if (pts0 > pts1) winner = 0;
    else if (pts1 > pts0) winner = 1;
    else winner = s.mano; // empate: gana el mano
    s.envido.state = 'accepted';
    s.envido.resolved = true;
    s.envido.winner = winner;
    s.envido.points = value;
    s.envido.shown = [pts0, pts1];
    pushLog(
      s,
      `Quiero. Envido: J0=${pts0} vs J1=${pts1}. Gana J${winner} (+${value})`
    );
    addScore(s, winner, value);
    return resumeAfterEnvido(s);
  }
  // truco
  s.truco.accepted = true;
  s.truco.canRaiseBy = who; // quien dijo quiero puede recantar
  s.handStake = TRUCO_QUIERO[s.truco.chain[s.truco.chain.length - 1]];
  pushLog(s, `Quiero. La mano vale ${s.handStake}`);
  s.phase = 'play';
  s.responder = null;
  return s;
}

function applyNoQuiero(s) {
  if (s.phase === 'envido-response') {
    const caller = s.envido.caller;
    const value = envidoNoQuieroValue(s.envido.chain, s);
    s.envido.state = 'declined';
    s.envido.resolved = true;
    s.envido.winner = caller;
    s.envido.points = value;
    pushLog(s, `No quiero. J${caller} +${value} de envido`);
    addScore(s, caller, value);
    return resumeAfterEnvido(s);
  }
  // truco: gana el que cantó, valor del nivel previo
  const caller = s.truco.caller;
  const value = TRUCO_NOQUIERO[s.truco.chain[s.truco.chain.length - 1]];
  pushLog(s, `No quiero. J${caller} gana la mano (+${value})`);
  return endHand(s, caller, value);
}

function applyMazo(s) {
  const p = s.turn;
  const winner = other(p);
  const value = s.handStake; // 1 si no hubo truco aceptado
  pushLog(s, `J${p} se va al mazo. J${winner} +${value}`);
  return endHand(s, winner, value);
}

// Retoma el flujo tras resolver el envido (puede haber truco suspendido).
function resumeAfterEnvido(s) {
  if (s.winner !== null) {
    s.phase = 'game-over';
    return s;
  }
  if (s.suspendedTruco) {
    s.suspendedTruco = false;
    s.phase = 'truco-response';
    s.responder = other(s.truco.caller);
    return s;
  }
  // El que cantó el envido retoma el turno que tenía.
  s.phase = 'play';
  s.responder = null;
  // El turno vuelve a quien le tocaba jugar (el que estaba "de mano" en la baza).
  s.turn = whoseTurnInTrick(s);
  return s;
}

// En la baza en curso, le toca al que todavía no jugó; si nadie jugó, al líder.
function whoseTurnInTrick(s) {
  const trick = s.tricks[s.tricks.length - 1];
  if (trick.plays.length === 0) {
    // líder de la baza: ganador anterior o mano
    if (s.results.length === 0) return s.mano;
    const last = s.results[s.results.length - 1];
    return last === 'parda' ? s.mano : last;
  }
  return other(trick.plays[0].player);
}

function handFull(s, p) {
  // Reconstruye la mano completa de 3 cartas (las que tiene + las que jugó).
  const played = [];
  for (const t of s.tricks) {
    for (const pl of t.plays) {
      if (pl.player === p) played.push(pl.card);
    }
  }
  return s.hands[p].concat(played);
}

function addScore(s, player, points) {
  s.scores[player] += points;
  if (s.scores[player] >= s.target) {
    s.winner = player;
  }
}

function endHand(s, winner, points) {
  s.handWinner = winner;
  s.handPoints = points;
  addScore(s, winner, points);
  pushLog(s, `Mano para J${winner}: +${points}`);
  s.phase = s.winner !== null ? 'game-over' : 'hand-over';
  return s;
}

// Pasa a la siguiente mano (alterna el que reparte).
export function nextHand(state, rng = Math.random) {
  return dealHand(
    {
      target: state.target,
      scores: state.scores,
      dealer: other(state.dealer),
    },
    rng
  );
}

// ---------- Utilidades de presentación ----------

export function labelBet(bet) {
  return {
    envido: 'Envido',
    realenvido: 'Real Envido',
    faltaenvido: 'Falta Envido',
    truco: 'Truco',
    retruco: 'Retruco',
    valecuatro: 'Vale Cuatro',
  }[bet];
}

export {
  envidoChainValue,
  envidoNoQuieroValue,
  faltaValue,
  TRUCO_QUIERO,
  TRUCO_NOQUIERO,
  other,
};
