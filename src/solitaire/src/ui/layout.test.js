import { describe, it, expect } from 'vitest';
import {
  computeSizes, renderModeFor, cardRadiusFor, RICH_MODE_MIN_CARD_W,
} from './layout.js';

describe('computeSizes', () => {
  it('fits seven cards plus six gaps into the board width', () => {
    const { cardW, gap } = computeSizes(980);
    expect(cardW * 7 + gap * 6).toBeCloseTo(980, 5);
  });

  it('keeps the locked 1:1.4 aspect ratio', () => {
    const { cardW, cardH } = computeSizes(980);
    expect(cardH).toBeCloseTo(cardW * 1.4, 5);
  });

  it('clamps the gap between 8 and 16', () => {
    expect(computeSizes(200).gap).toBe(8);
    expect(computeSizes(4000).gap).toBe(16);
    expect(computeSizes(700).gap).toBeCloseTo(700 * 0.018, 5);
  });

  it('never returns a negative card width, even for degenerate sizes', () => {
    expect(computeSizes(0).cardW).toBe(0);
    expect(computeSizes(10).cardW).toBeGreaterThanOrEqual(0);
    expect(computeSizes(40).cardW).toBeGreaterThanOrEqual(0);
    expect(computeSizes(100).cardW).toBeGreaterThan(0);
  });
});

describe('renderModeFor', () => {
  it('is rich at and above the threshold', () => {
    expect(renderModeFor(RICH_MODE_MIN_CARD_W)).toBe('rich');
    expect(renderModeFor(RICH_MODE_MIN_CARD_W + 40)).toBe('rich');
  });

  it('is simple below the threshold', () => {
    expect(renderModeFor(RICH_MODE_MIN_CARD_W - 1)).toBe('simple');
    expect(renderModeFor(44)).toBe('simple');
  });

  it('stays simple at the width where court art was measured illegible', () => {
    // The probe showed courts as mush at 44px and barely readable at 56px.
    expect(renderModeFor(56)).toBe('simple');
  });
});

describe('cardRadiusFor', () => {
  it('scales with card width and stays inside 4..10', () => {
    expect(cardRadiusFor(40)).toBeGreaterThanOrEqual(4);
    expect(cardRadiusFor(1000)).toBeLessThanOrEqual(10);
    expect(cardRadiusFor(120)).toBeGreaterThan(cardRadiusFor(50));
  });
});
