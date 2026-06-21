// Modo "Solver": el usuario describe la situación y recomendamos la jugada.
import { createHandState, legalActions, labelBet, other } from './engine.js';
import { recommend } from './ai.js';
import { compareCards, cardLabel, makeDeck, removeCards } from './cards.js';
import { cardPicker, clear } from './render.js';

const $ = (id) => document.getElementById(id);
let myPickers = [];
let playedRows = []; // { whoSel, picker, row }

export function initSolver() {
  const myBox = $('s-my-cards');
  myPickers = [];
  for (let i = 0; i < 3; i++) {
    const p = cardPicker();
    myPickers.push(p);
    myBox.appendChild(p);
  }
  $('s-add-play').addEventListener('click', addPlayedRow);
  $('s-solve').addEventListener('click', solve);
}

function addPlayedRow() {
  const list = $('s-played-list');
  const row = document.createElement('div');
  row.className = 'played-item';

  const whoSel = document.createElement('select');
  whoSel.appendChild(option('0', 'Yo tiré'));
  whoSel.appendChild(option('1', 'Rival tiró'));

  const picker = cardPicker();

  const del = document.createElement('button');
  del.className = 'act secondary';
  del.textContent = '✕';
  del.type = 'button';

  row.appendChild(whoSel);
  row.appendChild(picker);
  row.appendChild(del);
  list.appendChild(row);

  const entry = { whoSel, picker, row };
  playedRows.push(entry);
  del.addEventListener('click', () => {
    list.removeChild(row);
    playedRows = playedRows.filter((e) => e !== entry);
  });
}

function option(value, text) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = text;
  return o;
}

function solve() {
  const result = $('s-result');
  try {
    const state = buildState();
    const rec = recommend(state, 0, { mix: false, samples: 500 });
    renderResult(rec, state);
  } catch (e) {
    result.innerHTML = `<div class="action-rec" style="color:var(--red)">⚠ ${escapeHtml(e.message)}</div>`;
  }
}

function buildState() {
  const scoreMe = clampScore($('s-score-me').value);
  const scoreThem = clampScore($('s-score-them').value);
  const mano = Number($('s-mano').value); // 0 = yo, 1 = rival
  const dealer = other(mano);

  const myCards = myPickers.map((p) => p.getCard());
  if (myCards.some((c) => !c)) throw new Error('Cargá tus 3 cartas.');
  assertDistinct(myCards, 'Tenés cartas repetidas en tu mano.');

  const plays = playedRows.map((r) => {
    const card = r.picker.getCard();
    if (!card) throw new Error('Hay una carta jugada sin completar.');
    return { player: Number(r.whoSel.value), card };
  });

  // Validaciones de consistencia.
  const myPlayed = plays.filter((p) => p.player === 0).map((p) => p.card);
  for (const c of myPlayed) {
    if (!myCards.some((m) => m.rank === c.rank && m.suit === c.suit)) {
      throw new Error(`Jugaste el ${cardLabel(c)} pero no está en tus 3 cartas.`);
    }
  }
  const allKnown = myCards.concat(plays.filter((p) => p.player === 1).map((p) => p.card));
  assertDistinct(allKnown, 'Una carta del rival coincide con otra carta conocida.');

  // Manos iniciales: las mías reales, las del rival con relleno (sólo cuenta el número).
  const filler = removeCards(makeDeck(), allKnown).slice(0, 3);
  const hands = [myCards.map((c) => ({ ...c })), filler];
  const state = createHandState({ target: 30, scores: [scoreMe, scoreThem], dealer, hands });

  // Reproducir las cartas jugadas para armar bazas y resultados.
  for (const { player, card } of plays) {
    const trick = state.tricks[state.tricks.length - 1];
    trick.plays.push({ player, card });
    if (player === 0) {
      state.hands[0] = state.hands[0].filter((c) => !(c.rank === card.rank && c.suit === card.suit));
    } else {
      state.hands[1].pop(); // quitar un relleno (sólo importa el conteo)
    }
    if (trick.plays.length === 2) {
      const [a, b] = trick.plays;
      const cmp = compareCards(a.card, b.card);
      const res = cmp > 0 ? a.player : cmp < 0 ? b.player : 'parda';
      trick.winner = res;
      state.results.push(res);
      const leader = res === 'parda' ? state.mano : res;
      state.tricks.push({ plays: [] });
      state.turn = leader;
    } else {
      state.turn = other(player);
    }
  }

  // Situación de apuesta.
  applySituation(state, $('s-situation').value);
  return state;
}

function applySituation(state, sit) {
  if (sit === 'play') {
    state.phase = 'play';
    state.turn = 0; // el usuario afirma que le toca
    state.responder = null;
    return;
  }
  const envidoMap = {
    envido: ['envido'],
    'envido-envido': ['envido', 'envido'],
    real: ['realenvido'],
    'envido-real': ['envido', 'realenvido'],
    falta: ['faltaenvido'],
  };
  if (envidoMap[sit]) {
    if (state.results.length > 0) {
      // el envido sólo va en la primera baza
    }
    state.phase = 'envido-response';
    state.responder = 0;
    state.envido = { chain: envidoMap[sit], state: 'pending', caller: 1, resolved: false };
    return;
  }
  const trucoMap = {
    truco: { chain: ['truco'], accepted: false, stake: 1 },
    retruco: { chain: ['truco', 'retruco'], accepted: true, stake: 2 },
    valecuatro: { chain: ['truco', 'retruco', 'valecuatro'], accepted: true, stake: 3 },
  };
  if (trucoMap[sit]) {
    const t = trucoMap[sit];
    state.phase = 'truco-response';
    state.responder = 0;
    state.truco = { chain: t.chain, accepted: t.accepted, caller: 1, canRaiseBy: null };
    state.handStake = t.stake;
  }
}

function renderResult(rec, state) {
  const box = $('s-result');
  const what = describeAction(rec.action);
  let html = `<div class="action-rec">✅ Recomendación: ${what}</div>`;

  if (rec.distribution && rec.distribution.length) {
    html += '<div class="hint" style="margin-top:6px">Estrategia óptima no explotable (mezclá así):</div>';
    for (const d of rec.distribution) {
      const pct = Math.round(d.prob * 100);
      html += `<div style="display:flex;align-items:center;gap:8px;margin:2px 0">
        <span style="width:90px">${escapeHtml(d.label)}</span>
        <div class="bar" style="flex:1"><span style="width:${pct}%"></span></div>
        <b style="width:42px;text-align:right">${pct}%</b></div>`;
    }
  }

  html += reasoningList(rec.reasoning);

  if (typeof rec.winProb === 'number' && !Number.isNaN(rec.winProb)) {
    const pct = Math.round(rec.winProb * 100);
    html += `<div class="hint">Probabilidad de ganar la mano:</div>
             <div class="bar"><span style="width:${pct}%"></span></div>
             <div>${pct}%</div>`;
  }
  if (rec.envido) {
    html += `<div class="hint" style="margin-top:8px">Envido tuyo: <b>${rec.envido.myPoints}</b> · P(ganar envido) ≈ <b>${Math.round(rec.envido.pWin * 100)}%</b> · rival promedio ≈ ${rec.envido.mean.toFixed(1)}</div>`;
  }
  if (rec.options) {
    html += '<div class="hint" style="margin-top:8px">Valor esperado de cada opción:</div><ul>';
    for (const o of rec.options) {
      html += `<li>${escapeHtml(o.label)} → EV ${o.ev.toFixed(2)}</li>`;
    }
    html += '</ul>';
  }
  box.innerHTML = html;
}

function describeAction(action) {
  if (!action) return 'no hay jugada (revisá la situación)';
  if (action.type === 'play') return `Jugá el ${cardLabel(action.card)}`;
  if (action.type === 'quiero') return 'Decí QUIERO';
  if (action.type === 'noquiero') return 'Decí NO QUIERO';
  if (action.type === 'mazo') return 'Andate al mazo';
  if (action.type === 'call') return `Cantá ${labelBet(action.bet)}`;
  return action.type;
}

function reasoningList(lines) {
  if (!lines || !lines.length) return '';
  return '<ul>' + lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('') + '</ul>';
}

function clampScore(v) {
  const n = Math.max(0, Math.min(29, Math.floor(Number(v) || 0)));
  return n;
}

function assertDistinct(cards, msg) {
  const ids = cards.map((c) => `${c.rank}-${c.suit}`);
  if (new Set(ids).size !== ids.length) throw new Error(msg);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
