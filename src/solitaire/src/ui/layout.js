export const RICH_MODE_MIN_CARD_W = 76;

export function computeSizes(boardWidth) {
  const gap = Math.max(8, Math.min(16, boardWidth * 0.018));
  const cardW = Math.max(0, (boardWidth - gap * 6) / 7);
  return { cardW, cardH: cardW * 1.4, gap };
}

export function renderModeFor(cardW) {
  return cardW >= RICH_MODE_MIN_CARD_W ? 'rich' : 'simple';
}

export function cardRadiusFor(cardW) {
  return Math.max(4, Math.min(10, cardW * 0.075));
}

export function applySizes(rootEl, { cardW, cardH, gap }) {
  const s = rootEl.style;
  s.setProperty('--card-w', cardW + 'px');
  s.setProperty('--card-h', cardH + 'px');
  s.setProperty('--gap', gap + 'px');
  s.setProperty('--card-radius', cardRadiusFor(cardW) + 'px');
}
