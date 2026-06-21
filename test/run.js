// Pruebas básicas del motor y la IA. Ejecutar: node test/run.js
import {
  trucoPower,
  envidoPoints,
  compareCards,
  makeDeck,
} from '../src/cards.js';
import {
  newGame,
  legalActions,
  applyAction,
  handWinner,
  nextHand,
  createHandState,
  envidoChainValue,
  envidoNoQuieroValue,
} from '../src/engine.js';
import {
  recommend,
  envidoAnalysis,
  handWinProbability,
  responseDistribution,
  singProbability,
} from '../src/ai.js';

let passed = 0;
let failed = 0;
function eq(actual, expected, msg) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
  } else {
    failed++;
    console.error(`✗ ${msg}\n   esperado: ${JSON.stringify(expected)}\n   obtuvo:   ${JSON.stringify(actual)}`);
  }
}
function ok(cond, msg) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`✗ ${msg}`);
  }
}

// --- Jerarquía de cartas ---
ok(trucoPower({ rank: 1, suit: 'espada' }) === 14, '1 espada es la más alta');
ok(trucoPower({ rank: 1, suit: 'basto' }) === 13, '1 basto segunda');
ok(trucoPower({ rank: 7, suit: 'espada' }) > trucoPower({ rank: 7, suit: 'oro' }), '7 espada > 7 oro');
ok(trucoPower({ rank: 3, suit: 'oro' }) > trucoPower({ rank: 2, suit: 'oro' }), '3 > 2');
ok(trucoPower({ rank: 7, suit: 'copa' }) < trucoPower({ rank: 10, suit: 'oro' }), '7 copa < 10');
ok(compareCards({ rank: 3, suit: 'oro' }, { rank: 3, suit: 'copa' }) === 0, '3 vs 3 es parda');

// --- Envido ---
eq(envidoPoints([{ rank: 7, suit: 'oro' }, { rank: 6, suit: 'oro' }, { rank: 1, suit: 'copa' }]), 33, 'envido 7+6 oro = 33');
eq(envidoPoints([{ rank: 12, suit: 'oro' }, { rank: 11, suit: 'oro' }, { rank: 5, suit: 'copa' }]), 20, 'figuras valen 0 => 20');
eq(envidoPoints([{ rank: 4, suit: 'oro' }, { rank: 11, suit: 'copa' }, { rank: 7, suit: 'basto' }]), 7, 'sin par: carta más alta');
eq(envidoPoints([{ rank: 7, suit: 'oro' }, { rank: 7, suit: 'copa' }, { rank: 6, suit: 'oro' }]), 33, 'elige mejor palo');

// --- handWinner ---
eq(handWinner([0, 0], 1), 0, 'gana dos bazas');
eq(handWinner([0, 'parda'], 1), 0, 'gana 1ª, parda 2ª');
eq(handWinner(['parda', 1], 0), 1, 'parda 1ª, gana 2ª');
eq(handWinner([0, 1, 'parda'], 1), 0, '1-1 y parda 3ª: gana quien ganó la 1ª');
eq(handWinner(['parda', 'parda', 'parda'], 1), 1, 'todas pardas: gana el mano');
eq(handWinner([0], 1), null, 'una baza no define');

// --- Valores de envido ---
const stub = { target: 30, scores: [0, 0] };
eq(envidoChainValue(['envido'], stub), 2, 'envido vale 2');
eq(envidoChainValue(['envido', 'envido'], stub), 4, 'envido envido = 4');
eq(envidoChainValue(['envido', 'realenvido'], stub), 5, 'envido + real = 5');
eq(envidoChainValue(['realenvido'], stub), 3, 'real envido = 3');
eq(envidoChainValue(['faltaenvido'], stub), 30, 'falta al inicio = 30');
eq(envidoNoQuieroValue(['envido'], stub), 1, 'no quiero envido = 1');
eq(envidoNoQuieroValue(['envido', 'realenvido'], stub), 2, 'no quiero tras envido = 2');

// --- Partida completa IA vs IA (humo) ---
let g = newGame();
let safety = 0;
let hands = 0;
while (g.phase !== 'game-over' && safety < 5000) {
  safety++;
  if (g.phase === 'hand-over') {
    g = nextHand(g);
    hands++;
    if (hands > 200) break;
    continue;
  }
  const actor = g.phase === 'play' ? g.turn : g.responder;
  const rec = recommend(g, actor, { mix: true, samples: 60 });
  let action = rec.action;
  if (!action) {
    // fallback: primera acción legal
    action = legalActions(g)[0];
  }
  g = applyAction(g, action);
}
ok(g.phase === 'game-over', `la partida termina (fase=${g.phase}, safety=${safety})`);
ok(g.scores[0] >= 30 || g.scores[1] >= 30, `hay ganador: ${g.scores}`);
ok(safety < 5000, 'sin loop infinito');

// --- handWinProbability coherente: con la mejor mano posible, prob alta ---
const strong = createHandState({
  target: 30,
  scores: [0, 0],
  dealer: 1,
  hands: [
    [{ rank: 1, suit: 'espada' }, { rank: 1, suit: 'basto' }, { rank: 7, suit: 'espada' }],
    [{ rank: 4, suit: 'oro' }, { rank: 5, suit: 'copa' }, { rank: 6, suit: 'basto' }],
  ],
});
const pStrong = handWinProbability(strong, 0, 200);
ok(pStrong > 0.95, `mano monstruo gana casi siempre (p=${pStrong.toFixed(2)})`);

const weak = createHandState({
  target: 30,
  scores: [0, 0],
  dealer: 1,
  hands: [
    [{ rank: 4, suit: 'oro' }, { rank: 5, suit: 'copa' }, { rank: 6, suit: 'basto' }],
    [{ rank: 1, suit: 'espada' }, { rank: 1, suit: 'basto' }, { rank: 7, suit: 'espada' }],
  ],
});
const pWeak = handWinProbability(weak, 0, 200);
ok(pWeak < 0.05, `mano floja pierde casi siempre (p=${pWeak.toFixed(2)})`);

// --- envidoAnalysis ---
const envState = createHandState({
  target: 30,
  scores: [0, 0],
  dealer: 1,
  hands: [
    [{ rank: 7, suit: 'oro' }, { rank: 6, suit: 'oro' }, { rank: 4, suit: 'copa' }],
    [{ rank: 5, suit: 'basto' }, { rank: 4, suit: 'basto' }, { rank: 3, suit: 'copa' }],
  ],
});
const ea = envidoAnalysis(envState, 0);
eq(ea.myPoints, 33, 'envidoAnalysis calcula 33');
ok(ea.pWin > 0.95, `con 33 de envido gana casi siempre (p=${ea.pWin.toFixed(2)})`);

// --- Decisiones de la política (recommend) ---
function trucoResp(hand, oppLevel = 'truco') {
  const s = createHandState({
    target: 30,
    scores: [0, 0],
    dealer: 1,
    hands: [hand, [{ rank: 4, suit: 'oro' }, { rank: 5, suit: 'oro' }, { rank: 6, suit: 'oro' }]],
  });
  s.phase = 'truco-response';
  s.responder = 0;
  s.truco = { chain: [oppLevel], accepted: false, caller: 1, canRaiseBy: null };
  s.handStake = 1;
  return recommend(s, 0, { mix: false, samples: 150 });
}

const monster = [{ rank: 1, suit: 'espada' }, { rank: 1, suit: 'basto' }, { rank: 7, suit: 'espada' }];
const garbage = [{ rank: 4, suit: 'oro' }, { rank: 5, suit: 'copa' }, { rank: 6, suit: 'basto' }];

const rMonster = trucoResp(monster);
ok(rMonster.action.type !== 'noquiero', `con mano monstruo no se baja del truco (${rMonster.action.type})`);
const rGarbage = trucoResp(garbage);
ok(rGarbage.action.type === 'noquiero', `con mano basura no quiere el truco (${rGarbage.action.type})`);

// Envido response con 33 puntos: querer o subir, nunca bajarse.
function envidoResp(hand) {
  const s = createHandState({
    target: 30, scores: [0, 0], dealer: 1,
    hands: [hand, [{ rank: 4, suit: 'oro' }, { rank: 5, suit: 'oro' }, { rank: 6, suit: 'copa' }]],
  });
  s.phase = 'envido-response';
  s.responder = 0;
  s.envido = { chain: ['envido'], state: 'pending', caller: 1, resolved: false };
  return recommend(s, 0, { mix: false, samples: 100 });
}
const rEnv = envidoResp([{ rank: 7, suit: 'oro' }, { rank: 6, suit: 'oro' }, { rank: 4, suit: 'copa' }]);
ok(rEnv.action.type !== 'noquiero', `con 33 de envido no se baja (${rEnv.action.type})`);

// Play phase: devuelve una acción válida sin romperse.
const playState = createHandState({
  target: 30, scores: [0, 0], dealer: 1,
  hands: [monster, garbage],
});
const rPlay = recommend(playState, 0, { mix: false, samples: 100 });
ok(rPlay.action && ['play', 'call'].includes(rPlay.action.type), `en juego devuelve play/call (${rPlay.action && rPlay.action.type})`);

// --- Estrategias mixtas (no explotable) ---
const prob = (dist, type) => {
  const d = dist.find((x) => x.action.type === type);
  return d ? d.prob : 0;
};
const sumProb = (dist) => dist.reduce((s, d) => s + d.prob, 0);

// En el umbral del truco (p ≈ 0.25) la respuesta debe ser MIXTA: ni siempre
// quiero ni siempre no quiero (si no, sería explotable).
const atThreshold = responseDistribution(0.25, 2, 1, { bet: 'retruco', Vq: 3, Vnq: 2 });
ok(prob(atThreshold, 'quiero') > 0.05 && prob(atThreshold, 'quiero') < 0.95, 'en el umbral mezcla quiero/no quiero');
ok(Math.abs(sumProb(atThreshold) - 1) < 1e-9, 'la distribución suma 1');

// Mano fuerte (p alto): casi nunca se baja.
const strongResp = responseDistribution(0.9, 2, 1, { bet: 'retruco', Vq: 3, Vnq: 2 });
ok(prob(strongResp, 'noquiero') < 0.1, 'con mano fuerte casi no se baja');

// Mano floja: mayormente no quiero, pero con algo de farol acotado (no 0, no mucho).
const weakResp = responseDistribution(0.02, 2, 1, { bet: 'retruco', Vq: 3, Vnq: 2 });
const bluffFreq = prob(weakResp, 'call');
ok(bluffFreq > 0 && bluffFreq < 0.25, `el farol con mano floja está acotado (${bluffFreq.toFixed(2)})`);
ok(prob(weakResp, 'noquiero') > 0.7, 'con mano floja se baja la mayoría de las veces');

// singProbability: monótona y acotada.
ok(singProbability(0.95) > 0.9, 'con mano fuerte se canta casi siempre');
ok(singProbability(0.4) < 0.2, 'con mano media casi no se canta');
ok(singProbability(0.0) > 0 && singProbability(0.0) <= 0.4, 'farol de canto acotado con mano nula');

console.log(`\n${passed} pruebas OK, ${failed} fallaron.`);
process.exit(failed > 0 ? 1 : 0);
