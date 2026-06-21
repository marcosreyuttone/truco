// Modo "Jugar": humano (J0) contra la máquina (J1).
import {
  newGame,
  nextHand,
  legalActions,
  applyAction,
  labelBet,
} from './engine.js';
import { recommend } from './ai.js';
import { cardEl, clear } from './render.js';
import { cardLabel } from './cards.js';

let state = null;
let busy = false;
let suggested = null; // carta sugerida por el botón de ayuda

const $ = (id) => document.getElementById(id);

export function initPlay() {
  $('btn-new-game').addEventListener('click', () => startGame());
  $('btn-new-hand').addEventListener('click', () => {
    if (state && (state.phase === 'hand-over')) {
      state = nextHand(state);
      suggested = null;
      loop();
    }
  });
  $('btn-hint').addEventListener('click', showHint);
  startGame();
}

function startGame() {
  state = newGame();
  busy = false;
  suggested = null;
  setReasoning('<div class="muted">Empezó la partida. Sos "mano" en la primera.</div>');
  loop();
}

// Avanza el juego: si le toca a la máquina, juega sola; si no, espera al humano.
function loop() {
  render();
  if (!state || state.phase === 'game-over') return;

  if (state.phase === 'hand-over') {
    // Mostrar resultado y continuar automáticamente.
    busy = true;
    setTimeout(() => {
      busy = false;
      if (state.phase === 'hand-over') {
        state = nextHand(state);
        suggested = null;
        loop();
      }
    }, 1600);
    return;
  }

  const actor = state.phase === 'play' ? state.turn : state.responder;
  if (actor === 1) {
    busy = true;
    setTimeout(() => {
      const rec = recommend(state, 1, { mix: true, samples: 220 });
      const action = rec.action || legalActions(state).find((a) => a.player === 1);
      showMachineReasoning(rec, action);
      state = applyAction(state, action);
      busy = false;
      loop();
    }, 700);
  }
  // si actor === 0, esperamos input del humano (los botones ya están en render)
}

function render() {
  $('score-me').textContent = state.scores[0];
  $('score-ai').textContent = state.scores[1];

  const reveal = state.phase === 'hand-over' || state.phase === 'game-over';

  // Mano de la máquina
  const aiHand = $('ai-hand');
  clear(aiHand);
  for (const c of state.hands[1]) {
    aiHand.appendChild(cardEl(c, { back: !reveal }));
  }
  $('ai-hand-label').textContent = reveal
    ? 'Mano de la máquina (revelada)'
    : `Mano de la máquina (${state.hands[1].length} cartas)`;

  // Mesa: cartas jugadas por baza
  const table = $('table-cards');
  clear(table);
  for (const trick of state.tricks) {
    for (const play of trick.plays) {
      const el = cardEl(play.card, { small: true });
      el.title = play.player === 0 ? 'Vos' : 'Máquina';
      if (play.player === 1) el.style.outline = '2px solid rgba(192,57,43,0.6)';
      else el.style.outline = '2px solid rgba(174,233,197,0.6)';
      table.appendChild(el);
    }
  }

  // Tu mano
  const myHand = $('my-hand');
  clear(myHand);
  const myTurn = state.phase === 'play' && state.turn === 0;
  const playable = new Set(
    legalActions(state)
      .filter((a) => a.type === 'play' && a.player === 0)
      .map((a) => `${a.card.rank}-${a.card.suit}`)
  );
  for (const c of state.hands[0]) {
    const el = cardEl(c);
    const id = `${c.rank}-${c.suit}`;
    if (playable.has(id)) {
      el.classList.add('playable');
      el.addEventListener('click', () => humanAction({ type: 'play', card: c, player: 0 }));
    }
    if (suggested && suggested.rank === c.rank && suggested.suit === c.suit) {
      el.classList.add('suggested');
    }
    myHand.appendChild(el);
  }

  // Indicador de mano
  $('mano-indicator').textContent = state.mano === 0 ? '(sos mano)' : '(es mano la máquina)';

  // Botones de acción (cantos / respuestas)
  renderActions();

  // Log
  const log = $('play-log');
  clear(log);
  for (const line of state.log.slice(-40)) {
    const d = document.createElement('div');
    d.textContent = line.replace('J0', 'Vos').replace('J1', 'Máquina');
    log.appendChild(d);
  }
  log.scrollTop = log.scrollHeight;

  if (state.phase === 'game-over') {
    const won = state.scores[0] > state.scores[1];
    setReasoning(
      `<div class="action-rec">${won ? '🏆 ¡Ganaste la partida!' : '😞 Ganó la máquina.'}</div>` +
        `<div>Resultado final: ${state.scores[0]} - ${state.scores[1]}. Tocá "Nueva partida".</div>`
    );
  }
}

function renderActions() {
  const box = $('play-actions');
  clear(box);
  if (state.phase === 'game-over' || state.phase === 'hand-over') return;

  const actor = state.phase === 'play' ? state.turn : state.responder;
  if (actor !== 0) {
    const span = document.createElement('span');
    span.className = 'muted';
    span.textContent = 'Pensando…';
    box.appendChild(span);
    return;
  }

  const actions = legalActions(state).filter((a) => a.player === 0);
  for (const a of actions) {
    if (a.type === 'play') continue; // las cartas se juegan clickeando la mano
    let label, cls;
    if (a.type === 'quiero') { label = 'Quiero'; cls = 'act'; }
    else if (a.type === 'noquiero') { label = 'No quiero'; cls = 'act secondary'; }
    else if (a.type === 'mazo') { label = 'Irse al mazo'; cls = 'act danger'; }
    else if (a.type === 'call') { label = labelBet(a.bet); cls = 'act'; }
    const btn = document.createElement('button');
    btn.className = cls;
    btn.textContent = label;
    btn.addEventListener('click', () => humanAction(a));
    box.appendChild(btn);
  }
}

function humanAction(action) {
  if (busy) return;
  suggested = null;
  state = applyAction(state, action);
  loop();
}

function showHint() {
  if (!state || busy) return;
  const actor = state.phase === 'play' ? state.turn : state.responder;
  if (actor !== 0) {
    setReasoning('<div class="muted">No es tu turno.</div>');
    return;
  }
  const rec = recommend(state, 0, { mix: false, samples: 300 });
  suggested = rec.action && rec.action.type === 'play' ? rec.action.card : null;
  const what = describeAction(rec.action);
  setReasoning(
    `<div class="action-rec">💡 Sugerencia: ${what}</div>` +
      reasoningList(rec.reasoning)
  );
  render();
}

function showMachineReasoning(rec, action) {
  const what = describeAction(action);
  setReasoning(
    `<div class="action-rec">🤖 La máquina: ${what}</div>` +
      reasoningList(rec.reasoning || [])
  );
}

function describeAction(action) {
  if (!action) return '—';
  if (action.type === 'play') return `juega ${cardLabel(action.card)}`;
  if (action.type === 'quiero') return 'dice Quiero';
  if (action.type === 'noquiero') return 'dice No quiero';
  if (action.type === 'mazo') return 'se va al mazo';
  if (action.type === 'call') return `canta ${labelBet(action.bet)}`;
  return action.type;
}

function reasoningList(lines) {
  if (!lines || !lines.length) return '';
  return '<ul>' + lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('') + '</ul>';
}

function setReasoning(html) {
  $('play-reasoning').innerHTML = html;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
