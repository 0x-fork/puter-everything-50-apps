export const SUITS = ['♠', '♥', '♦', '♣'];

export const SUIT_COLOR = { '♠': 'black', '♣': 'black', '♥': 'red', '♦': 'red' };

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export const RANK_VAL = Object.fromEntries(RANKS.map((r, i) => [r, i + 1]));

export function newDeck(random = Math.random) {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank, color: SUIT_COLOR[suit], faceUp: false, id: suit + rank });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
