// Analiza partidas guardadas para encontrar ERRORES del bot y TENDENCIAS del
// rival. Lee un export del historial (con el campo `detail`: reparto + acciones
// por mano) y re-resuelve cada mano con el motor.
//
//   node train/analyze.js historial.json
//
// Qué reporta:
//  - Errores de JUEGO DE CARTAS del bot, certificados por minimax exacto
//    (info perfecta): manos que el bot podía ganar con las cartas y perdió por
//    elegir mal la carta. (No considera apuestas posteriores: es sobre cartas.)
//  - Balance de envido y de manos (bot vs humano).
//  - Tendencias del rival humano: cuánto canta/farolea el envido y el truco.
//
import { readFileSync } from 'node:fs';
import { createHandState, legalActions, applyAction, other } from '../src/engine.js';
import { exactCardWinner, exactWinnerIfPlay } from '../src/ai.js';
import { envidoPoints, trucoPower, cardLabel } from '../src/cards.js';

const BOT = 1; // la máquina es el jugador 1
const HUMAN = 0;

const file = process.argv[2];
if (!file) {
  console.error('Uso: node train/analyze.js <historial.json>');
  process.exit(1);
}
const games = JSON.parse(readFileSync(file, 'utf8'));

const cardEq = (a, b) => (!a && !b) || (a && b && a.rank === b.rank && a.suit === b.suit);
const handLabel = (h) => h.map(cardLabel).join(', ');

const stats = {
  games: 0,
  botGames: 0,
  hands: 0,
  handsReplayed: 0,
  skippedNoDetail: 0,
  skippedDesync: 0,
  botHandsWon: 0,
  cardErrors: [],
  envido: { events: 0, botNet: 0, humanCantos: 0, humanCantoTantos: [], humanQuiero: 0, humanNoQuiero: 0, humanBluffCantos: 0 },
  truco: { humanCantos: 0, humanCantoPowers: [], humanBluffCantos: 0, humanFolds: 0 },
};

function analyzeHand(hand) {
  const deal = hand.deal.map((h) => h.map((c) => ({ rank: c.rank, suit: c.suit })));
  let state = createHandState({ target: 30, scores: hand.scores.slice(), dealer: hand.dealer, hands: deal });
  const tantos = [envidoPoints(deal[0]), envidoPoints(deal[1])];
  const maxPow = [Math.max(...deal[0].map(trucoPower)), Math.max(...deal[1].map(trucoPower))];

  for (const a of hand.actions) {
    const legal = legalActions(state);
    const match = legal.find(
      (l) => l.player === a.p && l.type === a.type && l.bet === a.bet && cardEq(l.card, a.card)
    );
    if (!match) {
      stats.skippedDesync++;
      return;
    }

    // --- Error de carta del bot (minimax exacto, info perfecta) ---
    if (a.p === BOT && a.type === 'play' && state.phase === 'play' && state.turn === BOT) {
      const remaining = state.hands[BOT].length;
      if (remaining > 1) {
        const couldWin = exactCardWinner(state) === BOT;
        const willWin = exactWinnerIfPlay(state, BOT, a.card) === BOT;
        if (couldWin && !willWin) {
          const winners = state.hands[BOT]
            .filter((c) => exactWinnerIfPlay(state, BOT, c) === BOT)
            .map(cardLabel);
          stats.cardErrors.push({
            botHand: handLabel(state.hands[BOT]),
            humanHand: handLabel(state.hands[HUMAN]),
            played: cardLabel(a.card),
            winners,
            results: state.results.slice(),
          });
        }
      }
    }

    // --- Tendencias del rival (humano = J0) ---
    if (a.p === HUMAN && a.type === 'call') {
      const isEnvidoBet = ['envido', 'realenvido', 'faltaenvido'].includes(a.bet);
      if (isEnvidoBet) {
        stats.envido.humanCantos++;
        stats.envido.humanCantoTantos.push(tantos[HUMAN]);
        if (tantos[HUMAN] < 23) stats.envido.humanBluffCantos++; // canta sin gran tanto
      } else {
        stats.truco.humanCantos++;
        stats.truco.humanCantoPowers.push(maxPow[HUMAN]);
        if (maxPow[HUMAN] < 10) stats.truco.humanBluffCantos++; // canta sin carta brava
      }
    }
    if (a.p === HUMAN && state.phase === 'envido-response') {
      if (a.type === 'quiero') stats.envido.humanQuiero++;
      if (a.type === 'noquiero') stats.envido.humanNoQuiero++;
    }
    if (a.p === HUMAN && a.type === 'mazo') stats.truco.humanFolds++;

    state = applyAction(state, match);
  }

  stats.handsReplayed++;
  if (state.handWinner === BOT) stats.botHandsWon++;
  const e = state.envido;
  if (e && e.resolved && e.winner != null && e.points) {
    stats.envido.events++;
    stats.envido.botNet += e.winner === BOT ? e.points : -e.points;
  }
}

for (const g of games) {
  stats.games++;
  if (g.won === false) stats.botGames++; // g.won = ganó el humano; false => ganó el bot
  if (!Array.isArray(g.detail) || g.detail.length === 0) {
    stats.skippedNoDetail++;
    continue;
  }
  for (const hand of g.detail) {
    stats.hands++;
    try {
      analyzeHand(hand);
    } catch (err) {
      stats.skippedDesync++;
    }
  }
}

// ---------- Reporte ----------
const avg = (arr) => (arr.length ? (arr.reduce((s, x) => s + x, 0) / arr.length).toFixed(1) : '—');
const pct = (n, d) => (d ? ((100 * n) / d).toFixed(0) + '%' : '—');

console.log('===== ANÁLISIS DE PARTIDAS =====\n');
console.log(`Partidas: ${stats.games}  ·  ganó el bot: ${stats.botGames} (${pct(stats.botGames, stats.games)})`);
console.log(`Manos: ${stats.hands}  ·  re-resueltas: ${stats.handsReplayed}  ·  sin detalle: ${stats.skippedNoDetail}  ·  desincronizadas: ${stats.skippedDesync}`);
if (stats.handsReplayed === 0) {
  console.log('\n⚠ No hay manos con `detail` para analizar. Jugá partidas nuevas (ya guardan el reparto) y exportá de nuevo.');
  process.exit(0);
}
console.log(`Manos ganadas por el bot: ${stats.botHandsWon}/${stats.handsReplayed} (${pct(stats.botHandsWon, stats.handsReplayed)})`);

console.log('\n----- Juego de cartas: candidatos a error (minimax exacto, info perfecta) -----');
console.log(`Detectados: ${stats.cardErrors.length}/${stats.handsReplayed} manos ganables por cartas que el bot perdió.`);
console.log('OJO: con info perfecta. Incluye derrotas INEVITABLES (el bot no veía la');
console.log('mano del rival); un error REAL es cuando la carta ganadora era jugable a');
console.log('ciegas. Revisá cada caso comparando "jugó" vs "ganaban":');
for (const e of stats.cardErrors.slice(0, 12)) {
  console.log(`  • bot [${e.botHand}] vs humano [${e.humanHand}] | bazas ${JSON.stringify(e.results)} | jugó ${e.played} → ganaban: ${e.winners.join(' / ') || '—'}`);
}
if (stats.cardErrors.length > 12) console.log(`  … y ${stats.cardErrors.length - 12} más.`);

console.log('\n----- Envido -----');
console.log(`Manos con envido: ${stats.envido.events}  ·  balance neto del bot: ${stats.envido.botNet > 0 ? '+' : ''}${stats.envido.botNet} puntos`);

console.log('\n----- Tendencias del rival (humano) -----');
console.log(`Envido — cantó ${stats.envido.humanCantos} veces (tanto medio ${avg(stats.envido.humanCantoTantos)}); de esas, ${stats.envido.humanBluffCantos} con tanto < 23 (farol/marginal: ${pct(stats.envido.humanBluffCantos, stats.envido.humanCantos)}).`);
console.log(`Envido — respondió quiero ${stats.envido.humanQuiero}, no quiero ${stats.envido.humanNoQuiero}.`);
console.log(`Truco — cantó ${stats.truco.humanCantos} veces (carta más alta media ${avg(stats.truco.humanCantoPowers)}/14); de esas, ${stats.truco.humanBluffCantos} sin carta brava (poder < 10 = farol: ${pct(stats.truco.humanBluffCantos, stats.truco.humanCantos)}).`);
console.log(`Truco — se fue al mazo ${stats.truco.humanFolds} veces.`);
console.log('\nNota: los errores de carta son sobre el juego de cartas (info perfecta); no');
console.log('miden las apuestas. El balance/tendencias son contables, no a posteriori.');
