// Genera partidas de ejemplo en el MISMO formato que el export del historial
// (con `detail`: reparto + acciones por mano), para probar train/analyze.js sin
// datos reales. El bot (J1) usa la IA; el rival (J0) farolea como un humano.
//
//   node train/sim-history.js [partidas] [archivo.json] [samples]
//
import { newGame, nextHand, legalActions, applyAction } from '../src/engine.js';
import { recommend } from '../src/ai.js';
import { envidoPoints, trucoPower } from '../src/cards.js';
import { writeFileSync } from 'node:fs';

const N = Number(process.argv[2] || 30);
const OUT = process.argv[3] || '/tmp/sample-history.json';
const SAMP = Number(process.argv[4] || 25);

const lf = (s, p) => legalActions(s).filter((a) => a.player === p);
const sc = (c) => (c ? { rank: c.rank, suit: c.suit } : undefined);
const fh = (s, p) => { const o = []; for (const t of s.tricks) for (const x of t.plays) if (x.player === p) o.push(x.card); return s.hands[p].concat(o); };

function aiMove(s, p) {
  const r = recommend(s, p, { mix: true, samples: SAMP });
  const L = lf(s, p);
  return (r.action && L.some((l) => l.type === r.action.type && l.bet === r.action.bet &&
    (!l.card || (l.card.rank === r.action.card.rank && l.card.suit === r.action.card.suit)))) ? r.action : L[0];
}
// Rival "humano": farolea envido y truco con frecuencia.
function humanMove(s, p) {
  const L = lf(s, p);
  if (s.phase === 'envido-response') { const t = envidoPoints(fh(s, p)); const raise = L.find((a) => a.type === 'call');
    if (raise && t < 20 && Math.random() < 0.25) return raise;
    if (t >= 22) return L.find((a) => a.type === 'quiero') || L[0];
    if (t >= 18 && Math.random() < 0.5) return L.find((a) => a.type === 'quiero') || L[0];
    return L.find((a) => a.type === 'noquiero') || L[0]; }
  if (s.phase === 'truco-response') { const b = Math.max(...s.hands[p].map(trucoPower)); return (b >= 9 ? L.find((a) => a.type === 'quiero') : L.find((a) => a.type === 'mazo') || L.find((a) => a.type === 'noquiero')) || L[0]; }
  if (s.results.length === 0 && s.envido.state === 'none' && !s.truco.accepted) { const env = L.find((a) => a.type === 'call' && a.bet === 'envido'); const t = envidoPoints(fh(s, p));
    if (env && (t >= 23 || (t < 18 && Math.random() < 0.25))) return env; }
  if (s.truco.chain.length === 0 && Math.random() < 0.15) { const tr = L.find((a) => a.type === 'call' && a.bet === 'truco'); if (tr) return tr; }
  const pl = L.filter((a) => a.type === 'play').sort((a, b) => trucoPower(b.card) - trucoPower(a.card)); return pl.length ? pl[0] : L[0];
}

function playGame() {
  let s = newGame();
  const hands = [];
  const capture = () => hands.push({ dealer: s.dealer, mano: s.mano, scores: s.scores.slice(), deal: s.hands.map((h) => h.map(sc)), actions: [] });
  capture();
  let guard = 0;
  while (s.phase !== 'game-over' && guard++ < 4000) {
    if (s.phase === 'hand-over') { s = nextHand(s); capture(); continue; }
    const p = s.phase === 'play' ? s.turn : s.responder;
    const a = p === 1 ? aiMove(s, p) : humanMove(s, p);
    hands[hands.length - 1].actions.push({ p, type: a.type, bet: a.bet, card: sc(a.card) });
    s = applyAction(s, a);
  }
  return { ts: Date.now(), me: s.scores[0], ai: s.scores[1], won: s.scores[0] > s.scores[1], log: s.log.slice(), detail: hands };
}

const out = [];
for (let i = 0; i < N; i++) out.push(playGame());
writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`Generadas ${N} partidas en ${OUT}`);
