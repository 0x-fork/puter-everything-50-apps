import { describe, it, expect, beforeEach } from 'vitest';
import {
  emptyStats, mergeStats, recordGameStarted, recordGameWon,
  loadLocalStats, saveLocalStats, loadLocalSave, saveLocalSave, clearLocalSave,
  STATS_VERSION,
} from './stats.js';

// Minimal localStorage stand-in; vitest runs in the node environment.
beforeEach(() => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
});

describe('mergeStats', () => {
  it('takes the higher played and won counts', () => {
    const a = { v: 1, played: 10, won: 3, bestMoves: 200, ts: 1 };
    const b = { v: 1, played: 4, won: 4, bestMoves: 180, ts: 2 };
    const m = mergeStats(a, b);
    expect(m.played).toBe(10);
    expect(m.won).toBe(4);
  });

  it('takes the lower best-move count', () => {
    const a = { v: 1, played: 1, won: 1, bestMoves: 200, ts: 1 };
    const b = { v: 1, played: 1, won: 1, bestMoves: 150, ts: 1 };
    expect(mergeStats(a, b).bestMoves).toBe(150);
  });

  it('ignores a null best-move count rather than treating it as zero', () => {
    const a = { v: 1, played: 1, won: 0, bestMoves: null, ts: 1 };
    const b = { v: 1, played: 1, won: 1, bestMoves: 180, ts: 1 };
    expect(mergeStats(a, b).bestMoves).toBe(180);
    expect(mergeStats(b, a).bestMoves).toBe(180);
  });

  it('is null when neither side has won a game', () => {
    expect(mergeStats(emptyStats(), emptyStats()).bestMoves).toBe(null);
  });

  it('tolerates null and undefined inputs', () => {
    expect(mergeStats(null, null)).toEqual(emptyStats());
    expect(mergeStats(undefined, { v: 1, played: 2, won: 0, bestMoves: null, ts: 9 }).played).toBe(2);
  });

  it('keeps the later timestamp', () => {
    const a = { v: 1, played: 0, won: 0, bestMoves: null, ts: 5 };
    const b = { v: 1, played: 0, won: 0, bestMoves: null, ts: 99 };
    expect(mergeStats(a, b).ts).toBe(99);
  });
});

describe('recordGameStarted / recordGameWon', () => {
  it('increments played without touching won', () => {
    const s = recordGameStarted(emptyStats(), 100);
    expect(s.played).toBe(1);
    expect(s.won).toBe(0);
    expect(s.ts).toBe(100);
  });

  it('increments won and sets the first best-move count', () => {
    const s = recordGameWon(recordGameStarted(emptyStats(), 1), 143, 200);
    expect(s.won).toBe(1);
    expect(s.bestMoves).toBe(143);
  });

  it('lowers best moves only on an improvement', () => {
    let s = recordGameWon(emptyStats(), 143, 1);
    s = recordGameWon(s, 190, 2);
    expect(s.bestMoves).toBe(143);
    s = recordGameWon(s, 120, 3);
    expect(s.bestMoves).toBe(120);
  });
});

describe('local persistence', () => {
  it('returns empty stats when nothing is stored', () => {
    expect(loadLocalStats()).toEqual(emptyStats());
  });

  it('round-trips stats', () => {
    const s = recordGameWon(recordGameStarted(emptyStats(), 1), 99, 2);
    saveLocalStats(s);
    expect(loadLocalStats()).toEqual(s);
  });

  it('returns empty stats for corrupt or wrong-version data', () => {
    localStorage.setItem('solitaire.stats.v1', 'not json');
    expect(loadLocalStats()).toEqual(emptyStats());
    localStorage.setItem('solitaire.stats.v1', JSON.stringify({ v: 99 }));
    expect(loadLocalStats()).toEqual(emptyStats());
  });

  it('round-trips and clears a save', () => {
    const save = { v: 1, t: ['', '', '', '', '', '', ''], f: ['', '', '', ''], s: '', w: '', m: 0, ts: 7 };
    expect(loadLocalSave()).toBe(null);
    saveLocalSave(save);
    expect(loadLocalSave()).toEqual(save);
    clearLocalSave();
    expect(loadLocalSave()).toBe(null);
  });

  it('returns null for a corrupt save', () => {
    localStorage.setItem('solitaire.save.v1', '{{{');
    expect(loadLocalSave()).toBe(null);
  });

  it('does not throw when localStorage is unavailable', () => {
    globalThis.localStorage = {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
      removeItem() { throw new Error('denied'); },
    };
    expect(() => saveLocalStats(emptyStats())).not.toThrow();
    expect(loadLocalStats()).toEqual(emptyStats());
    expect(loadLocalSave()).toBe(null);
  });
});

describe('STATS_VERSION', () => {
  it('is 1', () => expect(STATS_VERSION).toBe(1));
});
