// Núcleo del mazo español de 40 cartas y reglas de valoración del Truco argentino.
//
// Una carta se representa como { rank, suit }
//   rank: 1,2,3,4,5,6,7,10,11,12  (no hay 8 ni 9)
//   suit: 'espada' | 'basto' | 'oro' | 'copa'

export const SUITS = ['espada', 'basto', 'oro', 'copa'];
export const RANKS = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12];

export const SUIT_SYMBOL = {
  espada: '🗡️',
  basto: '🪵',
  oro: '🪙',
  copa: '🍷',
};

export function makeDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

export function cardId(card) {
  return `${card.rank}-${card.suit}`;
}

export function cardLabel(card) {
  return `${card.rank} de ${card.suit}`;
}

export function parseCard(id) {
  const [rank, suit] = id.split('-');
  return { rank: Number(rank), suit };
}

// --- Jerarquía de poder en el Truco (mayor = más fuerte) ---
//
// 1) 1 espada  2) 1 basto  3) 7 espada  4) 7 oro
// 5) los 3     6) los 2    7) 1 oro / 1 copa
// 8) los 12    9) los 11   10) los 10
// 11) 7 copa / 7 basto      12) los 6   13) los 5   14) los 4
const SPECIAL_POWER = {
  '1-espada': 14,
  '1-basto': 13,
  '7-espada': 12,
  '7-oro': 11,
  '7-copa': 4,
  '7-basto': 4,
};

const RANK_TIER = {
  3: 10,
  2: 9,
  1: 8, // 1 de oro / 1 de copa (los machos verdaderos ya están arriba)
  12: 7,
  11: 6,
  10: 5,
  7: 4, // 7 copa/basto (los 7 fuertes ya están arriba)
  6: 3,
  5: 2,
  4: 1,
};

export function trucoPower(card) {
  const special = SPECIAL_POWER[cardId(card)];
  if (special !== undefined) return special;
  return RANK_TIER[card.rank];
}

// Devuelve 1 si a gana, -1 si b gana, 0 si es parda (empate de poder).
export function compareCards(a, b) {
  const pa = trucoPower(a);
  const pb = trucoPower(b);
  if (pa > pb) return 1;
  if (pa < pb) return -1;
  return 0;
}

// --- Envido ---
// Las figuras (10, 11, 12) valen 0. El resto vale su número.
export function envidoCardValue(card) {
  return card.rank >= 10 ? 0 : card.rank;
}

// Puntos de envido de una mano (cualquier cantidad de cartas, normalmente 3).
export function envidoPoints(cards) {
  let best = 0;
  for (const suit of SUITS) {
    const sameSuit = cards
      .filter((c) => c.suit === suit)
      .map(envidoCardValue)
      .sort((x, y) => y - x);
    if (sameSuit.length >= 2) {
      best = Math.max(best, 20 + sameSuit[0] + sameSuit[1]);
    }
  }
  if (best === 0) {
    // Sin dos cartas del mismo palo: vale la carta más alta sola.
    best = Math.max(0, ...cards.map(envidoCardValue));
  }
  return best;
}

// Saca de un mazo las cartas indicadas (por identidad rank+suit).
export function removeCards(deck, cards) {
  const ids = new Set(cards.map(cardId));
  return deck.filter((c) => !ids.has(cardId(c)));
}

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
