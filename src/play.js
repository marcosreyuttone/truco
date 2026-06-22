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
import { SHOW_THINKING } from './config.js';
import { pushGame, playerId } from './remote-history.js';

let state = null;
let busy = false;
let suggested = null; // carta sugerida por el botón de ayuda
let gameSaved = false; // para guardar cada partida una sola vez

const HISTORY_KEY = 'truco-history-v1';

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
  if (SHOW_THINKING) {
    $('btn-hint').addEventListener('click', showHint);
  } else {
    // Ocultar el "cómo piensa": panel de razonamiento y botón de sugerencia.
    $('play-reasoning').style.display = 'none';
    $('btn-hint').style.display = 'none';
  }
  $('btn-clear-history').addEventListener('click', () => {
    saveHistory([]);
    renderHistory();
  });
  renderHistory();
  startGame();
}

function startGame() {
  state = newGame();
  busy = false;
  suggested = null;
  gameSaved = false;
  setReasoning('<div class="muted">Empezó la partida. Sos "mano" en la primera.</div>');
  loop();
}

// Avanza el juego: si le toca a la máquina, juega sola; si no, espera al humano.
function loop() {
  render();
  if (!state) return;
  if (state.phase === 'game-over') {
    recordGameOnce();
    return;
  }

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
      const rec = recommend(state, 1, { mix: true, samples: 300 });
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

  // Mesa: cartas jugadas, agrupadas por baza, con el ganador resaltado.
  const table = $('table-cards');
  clear(table);
  for (const trick of state.tricks) {
    for (const play of trick.plays) {
      const pair = document.createElement('div');
      pair.className = 'played-pair';
      if (trick.winner !== undefined && trick.winner === play.player) {
        pair.classList.add('win-card');
      }
      const tag = document.createElement('div');
      tag.className = 'tag';
      tag.textContent = play.player === 0 ? 'Vos' : 'Máquina';
      pair.appendChild(cardEl(play.card, { small: true }));
      pair.appendChild(tag);
      table.appendChild(pair);
    }
  }
  if (table.children.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'muted';
    empty.textContent = 'Sin cartas todavía';
    table.appendChild(empty);
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

  // Chips de "mano" en el tanteador.
  $('chip-me').classList.toggle('hidden', state.mano !== 0);
  $('chip-ai').classList.toggle('hidden', state.mano !== 1);

  // Banner de estado + resaltado del panel del jugador.
  updateStatus();

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

function updateStatus() {
  const banner = $('status-banner');
  const myPanel = $('my-panel');
  let text = '';
  let cls = '';
  if (state.phase === 'game-over') {
    const won = state.scores[0] > state.scores[1];
    text = won ? '🏆 ¡Ganaste la partida!' : '😞 Ganó la máquina';
    cls = won ? 'win' : 'lose';
  } else if (state.phase === 'hand-over') {
    const won = state.handWinner === 0;
    text = (won ? '✅ Ganaste la mano' : '❌ La máquina ganó la mano') + ` (+${state.handPoints})`;
    cls = won ? 'win' : 'lose';
  } else {
    const actor = state.phase === 'play' ? state.turn : state.responder;
    if (actor === 1) {
      text = '<span class="spinner"></span>La máquina está pensando…';
      cls = 'thinking';
    } else {
      cls = 'your-turn';
      if (state.phase === 'truco-response') {
        text = `🔔 Te cantaron ${labelBet(state.truco.chain[state.truco.chain.length - 1])} — ¿qué hacés?`;
      } else if (state.phase === 'envido-response') {
        text = `🔔 Te cantaron ${labelBet(state.envido.chain[state.envido.chain.length - 1])} — ¿qué hacés?`;
      } else {
        text = '🎯 Tu turno: jugá una carta o cantá';
      }
    }
  }
  banner.innerHTML = text;
  banner.className = cls;
  myPanel.classList.toggle('highlight', cls === 'your-turn');
}

function renderActions() {
  const box = $('play-actions');
  clear(box);
  if (state.phase === 'game-over' || state.phase === 'hand-over') return;

  const actor = state.phase === 'play' ? state.turn : state.responder;
  if (actor !== 0) return; // el banner ya muestra "pensando…"

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
  if (!SHOW_THINKING) return;
  $('play-reasoning').innerHTML = html;
}

// ---------- Historial de partidas (persistente en el navegador) ----------

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}

function saveHistory(arr) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(arr));
  } catch {
    /* almacenamiento no disponible */
  }
}

function recordGameOnce() {
  if (gameSaved || !state || state.phase !== 'game-over') return;
  gameSaved = true;
  const record = {
    ts: Date.now(),
    me: state.scores[0],
    ai: state.scores[1],
    won: state.scores[0] > state.scores[1],
    log: state.log.slice(),
  };
  const hist = loadHistory();
  hist.push(record);
  if (hist.length > 200) hist.splice(0, hist.length - 200);
  saveHistory(hist);
  renderHistory();

  // Copia central (todos los jugadores) en Supabase. No bloquea ni rompe.
  pushGame({
    player_id: playerId(),
    score_me: record.me,
    score_ai: record.ai,
    won: record.won,
    log: record.log,
    app: 'truco-web',
  });
}

function renderHistory() {
  const hist = loadHistory();
  const wins = hist.filter((g) => g.won).length;
  const losses = hist.length - wins;
  const summary = $('history-summary');
  if (summary) {
    summary.textContent = hist.length
      ? `Vos ${wins} – ${losses} Máquina  ·  ${hist.length} partida${hist.length === 1 ? '' : 's'}`
      : 'Todavía no terminaste ninguna partida.';
  }
  const list = $('history-list');
  if (!list) return;
  clear(list);
  for (const g of hist.slice().reverse().slice(0, 30)) {
    const row = document.createElement('div');
    row.textContent = `${g.won ? '✅' : '❌'} ${g.me}-${g.ai}  ·  ${new Date(g.ts).toLocaleString()}`;
    row.style.cursor = 'pointer';
    row.title = 'Ver jugadas de la partida';
    row.addEventListener('click', () => {
      const next = row.nextSibling;
      if (next && next.dataset && next.dataset.log === '1') {
        next.remove();
        return;
      }
      const pre = document.createElement('div');
      pre.dataset.log = '1';
      pre.style.whiteSpace = 'pre-wrap';
      pre.style.opacity = '0.6';
      pre.style.fontSize = '0.72rem';
      pre.style.padding = '4px 0 8px';
      pre.textContent = (g.log || [])
        .map((l) => l.replace(/J0/g, 'Vos').replace(/J1/g, 'Máquina'))
        .join('\n');
      row.after(pre);
    });
    list.appendChild(row);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
