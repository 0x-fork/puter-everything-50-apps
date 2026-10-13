export const STATS_VERSION = 1;

const STATS_KEY = 'solitaire.stats.v1';
const SAVE_KEY = 'solitaire.save.v1';

export function emptyStats() {
  return { v: STATS_VERSION, played: 0, won: 0, bestMoves: null, ts: 0 };
}

function minDefined(a, b) {
  const vals = [a, b].filter(v => typeof v === 'number' && Number.isFinite(v));
  return vals.length ? Math.min(...vals) : null;
}

export function mergeStats(a, b) {
  return {
    v: STATS_VERSION,
    played: Math.max(a?.played || 0, b?.played || 0),
    won: Math.max(a?.won || 0, b?.won || 0),
    bestMoves: minDefined(a?.bestMoves, b?.bestMoves),
    ts: Math.max(a?.ts || 0, b?.ts || 0),
  };
}

export function recordGameStarted(stats, now) {
  return { ...stats, v: STATS_VERSION, played: (stats.played || 0) + 1, ts: now };
}

export function recordGameWon(stats, moves, now) {
  return {
    ...stats,
    v: STATS_VERSION,
    won: (stats.won || 0) + 1,
    bestMoves: minDefined(stats.bestMoves, moves),
    ts: now,
  };
}

function readJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing or a full quota. Losing stats is not worth an exception.
  }
}

export function loadLocalStats() {
  const parsed = readJSON(STATS_KEY);
  if (!parsed || parsed.v !== STATS_VERSION) return emptyStats();
  return { ...emptyStats(), ...parsed };
}

export function saveLocalStats(stats) {
  writeJSON(STATS_KEY, stats);
}

export function loadLocalSave() {
  return readJSON(SAVE_KEY);
}

export function saveLocalSave(save) {
  writeJSON(SAVE_KEY, save);
}

export function clearLocalSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // Ignore.
  }
}
