// Helpers de render de cartas y selectores reutilizables.
import { SUITS, RANKS, SUIT_SYMBOL } from './cards.js';

export function cardEl(card, { small = false, back = false } = {}) {
  const el = document.createElement('div');
  el.className = 'card' + (small ? ' small' : '') + (back ? ' back' : ' ' + card.suit);
  if (back) {
    el.innerHTML = '<div class="card-back-logo">🃏</div>';
    return el;
  }
  const sym = SUIT_SYMBOL[card.suit];
  el.innerHTML = `
    <div class="corner top"><span class="r">${card.rank}</span><span class="s">${sym}</span></div>
    <div class="pip">${sym}</div>
    <div class="corner bot"><span class="r">${card.rank}</span><span class="s">${sym}</span></div>`;
  return el;
}

// Selector de una carta (rank + suit) que devuelve {rank, suit} o null.
export function cardPicker(initial = null) {
  const wrap = document.createElement('span');
  wrap.className = 'card-picker';
  const rankSel = document.createElement('select');
  const suitSel = document.createElement('select');

  rankSel.appendChild(opt('', '—'));
  for (const r of RANKS) rankSel.appendChild(opt(String(r), String(r)));
  suitSel.appendChild(opt('', '—'));
  for (const s of SUITS) suitSel.appendChild(opt(s, `${SUIT_SYMBOL[s]} ${s}`));

  if (initial) {
    rankSel.value = String(initial.rank);
    suitSel.value = initial.suit;
  }

  wrap.appendChild(rankSel);
  wrap.appendChild(suitSel);
  wrap.getCard = () => {
    if (!rankSel.value || !suitSel.value) return null;
    return { rank: Number(rankSel.value), suit: suitSel.value };
  };
  return wrap;
}

function opt(value, text) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = text;
  return o;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}
