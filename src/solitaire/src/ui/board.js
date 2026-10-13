import { computeSizes, applySizes, renderModeFor } from './layout.js';
import { cardEl, slotEl } from './cardview.js';

function makePile(kind, index) {
  const p = document.createElement('div');
  p.className = 'pile';
  p.dataset.kind = kind;
  p.dataset.index = index;
  return p;
}

export function render(ctx) {
  const { boardEl, game, hooks } = ctx;

  const sizes = computeSizes(boardEl.clientWidth);
  applySizes(document.documentElement, sizes);
  const mode = renderModeFor(sizes.cardW);
  boardEl.dataset.mode = mode;

  boardEl.innerHTML = '';

  const top = document.createElement('div');
  top.className = 'row top';
  boardEl.appendChild(top);

  // Stock
  const stockPile = makePile('stock', 0);
  if (game.stock.length === 0) {
    stockPile.appendChild(slotEl(game.waste.length ? 'refresh' : 'block'));
  } else {
    game.stock.slice(-Math.min(3, game.stock.length)).forEach(c => {
      stockPile.appendChild(cardEl({ ...c, faceUp: false }, mode));
    });
  }
  hooks.attachStockTap(stockPile);
  if (game.stock.length) {
    const counter = document.createElement('div');
    counter.className = 'stock-counter';
    counter.textContent = game.stock.length;
    stockPile.appendChild(counter);
  }
  top.appendChild(stockPile);

  // Waste — last few fanned right so the pile reads as a stack
  const wastePile = makePile('waste', 0);
  if (!game.waste.length) {
    wastePile.appendChild(slotEl());
  } else {
    const fanX = Math.max(6, sizes.cardW * 0.10);
    const visible = game.waste.slice(-3);
    const startIdx = game.waste.length - visible.length;
    let topCardEl = null;
    let topCard = null;
    visible.forEach((c, i) => {
      const e = cardEl(c, mode);
      e.style.left = (i * fanX) + 'px';
      if (i === visible.length - 1) {
        hooks.attachDrag(e, { from: 'waste', fromIndex: startIdx + i });
        topCardEl = e;
        topCard = c;
      } else {
        e.style.pointerEvents = 'none';
      }
      wastePile.appendChild(e);
    });
    if (topCardEl) hooks.afterCard(topCardEl, topCard);
  }
  top.appendChild(wastePile);

  top.appendChild(document.createElement('div')); // spacer

  // Foundations
  for (let i = 0; i < 4; i++) {
    const fp = makePile('foundation', i);
    const pile = game.foundations[i];
    if (!pile.length) {
      fp.appendChild(slotEl('star'));
    } else {
      const last = pile[pile.length - 1];
      const e = cardEl(last, mode);
      hooks.attachDrag(e, { from: 'foundation', fromIndex: i });
      fp.appendChild(e);
    }
    top.appendChild(fp);
  }

  // Tableau
  const tab = document.createElement('div');
  tab.className = 'row tableau';
  boardEl.appendChild(tab);

  const fanFaceDown = Math.max(10, sizes.cardH * 0.10);
  const fanFaceUp = Math.max(18, sizes.cardH * 0.22);

  for (let i = 0; i < 7; i++) {
    const pile = makePile('tableau', i);
    pile.classList.add('tableau');
    const col = game.tableau[i];
    if (!col.length) {
      pile.appendChild(slotEl());
    } else {
      let offset = 0;
      col.forEach((c, idx) => {
        const e = cardEl(c, mode);
        e.style.top = offset + 'px';
        pile.appendChild(e);
        if (c.faceUp) hooks.attachDrag(e, { from: 'tableau', fromIndex: i, cardIndex: idx });
        hooks.afterCard(e, c);
        offset += c.faceUp ? fanFaceUp : fanFaceDown;
      });
      pile.style.height = (offset + sizes.cardH) + 'px';
    }
    tab.appendChild(pile);
  }
}
