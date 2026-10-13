import { newDeck } from './deck.js';
import { canPlaceOnTableau, canPlaceOnFoundation } from './rules.js';

export const HISTORY_LIMIT = 200;

export function createGame(deck = newDeck()) {
  const cards = deck.slice();
  const tableau = [[], [], [], [], [], [], []];
  for (let i = 0; i < 7; i++) {
    for (let j = i; j < 7; j++) {
      const c = cards.pop();
      if (j === i) c.faceUp = true;
      tableau[j].push(c);
    }
  }
  return {
    tableau,
    foundations: [[], [], [], []],
    stock: cards,
    waste: [],
    moves: 0,
    history: [],
  };
}

export function snapshot(game) {
  game.history.push(JSON.parse(JSON.stringify({
    tableau: game.tableau,
    foundations: game.foundations,
    stock: game.stock,
    waste: game.waste,
    moves: game.moves,
  })));
  if (game.history.length > HISTORY_LIMIT) game.history.shift();
}

export function undo(game) {
  if (!game.history.length) return false;
  const prev = game.history.pop();
  game.tableau = prev.tableau;
  game.foundations = prev.foundations;
  game.stock = prev.stock;
  game.waste = prev.waste;
  game.moves = prev.moves;
  return true;
}

export function getMovingCards(game, from) {
  if (from.from === 'tableau') return game.tableau[from.fromIndex].slice(from.cardIndex);
  if (from.from === 'waste') return game.waste.slice(-1);
  if (from.from === 'foundation') return game.foundations[from.fromIndex].slice(-1);
  return [];
}

export function applyMove(game, from, to, cards) {
  if (to.kind === 'foundation') {
    if (cards.length !== 1) return { ok: false, flipped: null };
    if (!canPlaceOnFoundation(cards[0], game.foundations[to.index])) {
      return { ok: false, flipped: null };
    }
  } else if (to.kind === 'tableau') {
    if (!canPlaceOnTableau(cards[0], game.tableau[to.index])) {
      return { ok: false, flipped: null };
    }
  } else {
    return { ok: false, flipped: null };
  }

  if (from.from === to.kind && from.fromIndex === to.index) {
    return { ok: false, flipped: null };
  }
  // Foundation-to-foundation can only shuffle an Ace between empty slots: never
  // a real move, but a tap on a foundation Ace would otherwise autoMove it there.
  if (from.from === 'foundation' && to.kind === 'foundation') {
    return { ok: false, flipped: null };
  }

  snapshot(game);

  let flipped = null;
  if (from.from === 'tableau') {
    game.tableau[from.fromIndex].splice(from.cardIndex);
    const col = game.tableau[from.fromIndex];
    if (col.length && !col[col.length - 1].faceUp) {
      col[col.length - 1].faceUp = true;
      flipped = col[col.length - 1].id;
    }
  } else if (from.from === 'waste') {
    game.waste.pop();
  } else if (from.from === 'foundation') {
    game.foundations[from.fromIndex].pop();
  }

  if (to.kind === 'foundation') game.foundations[to.index].push(cards[0]);
  else game.tableau[to.index].push(...cards);

  game.moves++;
  return { ok: true, flipped };
}

export function drawFromStock(game) {
  if (!game.stock.length && !game.waste.length) {
    return { ok: false, drawn: null, recycled: false };
  }
  snapshot(game);
  let drawn = null;
  let recycled = false;
  if (!game.stock.length) {
    game.stock = game.waste.reverse().map(c => ({ ...c, faceUp: false }));
    game.waste = [];
    recycled = true;
  } else {
    const c = game.stock.pop();
    c.faceUp = true;
    game.waste.push(c);
    drawn = c.id;
  }
  game.moves++;
  return { ok: true, drawn, recycled };
}
