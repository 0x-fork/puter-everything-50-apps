// Amplitude Statistics panel: scans the selection or the whole file in an
// analysis worker (Rust kernels) and reports per channel peak and true peak
// levels, clipping, DC offset, sample extremes, RMS levels, measured bit
// depth, dynamic range and BS.1770-4 loudness. The report can be copied.

import { h, announce } from '../lib/dom.js';
import { icon } from '../ui/icons.js';
import { analysisPool } from './pool.js';
import { fmtDb, gainToDb } from './common.js';

const CHUNK = 1 << 18;
const NAMES = ['Left', 'Right', 'Center', 'LFE', 'Left Surround', 'Right Surround'];

/** Streams frames [start, end) of channels through a worker stats session. */
export async function scanStats(channels, rate, start, end, { onProgress, signal } = {}) {
  const pool = analysisPool();
  const session = await pool.session('stats', { rate, channels: channels.length });
  const win = Math.max(1, Math.round(rate * 0.05));
  const chunk = Math.max(win, Math.floor(CHUNK / win) * win);
  try {
    for (let at = start; at < end; at += chunk) {
      if (signal?.aborted) throw new Error('Cancelled');
      const n = Math.min(chunk, end - at);
      await session.push(channels.map((c) => c.toArray(at, at + n)));
      onProgress?.((at + n - start) / Math.max(1, end - start));
    }
  } catch (err) {
    session.close().catch(() => {});
    throw err;
  }
  return session.close();
}

/** Report rows from a stats result: [label, perChannel[] | single value]. */
export function statsRows(result, channelCount) {
  const ch = result.channels;
  const L = result.loudness;
  const per = (fn) => ch.slice(0, channelCount).map(fn);
  const frames = (c) => Math.max(1, c.frames);
  return [
    ['Peak Amplitude', per((c) => `${fmtDb(gainToDb(Math.max(Math.abs(c.min), Math.abs(c.max))))} dB`)],
    ['True Peak Amplitude', per((c, i) => `${fmtDb(gainToDb(L.truePeak[i]))} dBTP`)],
    ['Possibly Clipped Samples', per((c) => String(c.clipped))],
    ['DC Offset', per((c) => `${((c.sum / frames(c)) * 100).toFixed(3)} %`)],
    ['Minimum Sample Value', per((c) => (c.frames ? c.min.toFixed(5) : '0'))],
    ['Maximum Sample Value', per((c) => (c.frames ? c.max.toFixed(5) : '0'))],
    ['Minimum RMS Amplitude', per((c) => `${fmtDb(gainToDb(c.rmsCount ? c.rmsMin : 0))} dB`)],
    ['Maximum RMS Amplitude', per((c) => `${fmtDb(gainToDb(c.rmsMax))} dB`)],
    ['Average RMS Amplitude', per((c) => `${fmtDb(gainToDb(c.rmsCount ? c.rmsSum / c.rmsCount : 0))} dB`)],
    ['Total RMS Amplitude', per((c) => `${fmtDb(gainToDb(Math.sqrt(c.sq / frames(c))))} dB`)],
    ['Dynamic Range', per((c) => (c.rmsCount && c.rmsMin > 0 ? `${(gainToDb(c.rmsMax) - gainToDb(c.rmsMin)).toFixed(2)} dB` : '∞ dB'))],
    ['Measured Bit Depth', per((c) => (c.bits === 0 ? 'Silent' : c.bits === 32 ? '32 (float)' : String(c.bits)))],
    ['Integrated Loudness', `${fmtDb(L.integrated)} LUFS`],
    ['Loudness Range', `${L.range.toFixed(2)} LU`],
    ['Maximum Momentary Loudness', `${fmtDb(L.maxMomentary)} LUFS`],
    ['Maximum Short-Term Loudness', `${fmtDb(L.maxShortTerm)} LUFS`],
  ];
}

export function amplitudePanel(app) {
  const scanSel = h('button.btn', { type: 'button', onclick: () => scan(true) }, 'Scan Selection');
  const scanAll = h('button.btn', { type: 'button', onclick: () => scan(false) }, 'Scan File');
  const cancelBtn = h('button.btn', { type: 'button', hidden: true, onclick: () => abort?.abort() }, 'Cancel');
  const copyBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Copy statistics', title: 'Copy statistics as text', disabled: true, onclick: () => copy() }, icon('copy', 14));
  const toolbar = h('div.panel-toolbar.analysis-toolbar', scanSel, scanAll, cancelBtn, h('div.spacer'), copyBtn);
  const progress = h('div.analysis-progress', { role: 'progressbar', 'aria-label': 'Scan progress', 'aria-valuemin': '0', 'aria-valuemax': '100', hidden: true }, h('div.analysis-progress-bar'));
  const caption = h('div.analysis-caption', { 'aria-live': 'polite' });
  const head = h('thead');
  const body = h('tbody');
  const table = h('table.data-table.stats-table', { 'aria-label': 'Amplitude statistics' }, head, body);
  const el = h('div.analysis-panel.amplitude-panel', toolbar, progress, caption, h('div.table-scroll', table));

  let abort = null;
  let last = null; // { rows, names, title }

  const refresh = () => {
    const doc = app.active?.kind === 'audio' ? app.active : null;
    const busy = Boolean(abort);
    scanSel.disabled = busy || !doc?.hasSelection;
    scanAll.disabled = busy || !doc?.length;
    cancelBtn.hidden = !busy;
    copyBtn.disabled = !last;
    if (!last) {
      head.replaceChildren();
      body.replaceChildren(h('tr', h('td.empty-row', h('span.empty-text', doc ? 'Scan the selection or the whole file to measure its levels.' : 'Open an audio file to measure its levels.'))));
    }
  };

  const render = () => {
    const { rows, names } = last;
    head.replaceChildren(h('tr', h('th', { scope: 'col' }, ''), ...names.map((n) => h('th.num', { scope: 'col' }, n))));
    body.replaceChildren(
      ...rows.map(([label, v]) =>
        h('tr', h('th', { scope: 'row' }, label), ...(Array.isArray(v) ? v.map((x) => h('td.num', x)) : [h('td.num', { colspan: String(names.length) }, v)])),
      ),
    );
  };

  async function scan(selectionOnly) {
    const doc = app.active;
    if (!doc || doc.kind !== 'audio' || abort) return;
    const [start, end] = selectionOnly && doc.hasSelection ? [doc.selection.start, doc.selection.end] : [0, doc.length];
    abort = new AbortController();
    progress.hidden = false;
    const bar = progress.firstChild;
    bar.style.width = '0%';
    caption.textContent = `Scanning ${doc.name}...`;
    refresh();
    try {
      const result = await scanStats(doc.state.channels, doc.sampleRate, start, end, {
        signal: abort.signal,
        onProgress: (f) => {
          bar.style.width = `${Math.round(f * 100)}%`;
          progress.setAttribute('aria-valuenow', String(Math.round(f * 100)));
        },
      });
      const n = doc.channelCount;
      const names = n === 1 ? ['Mono'] : doc.state.channels.map((_, i) => NAMES[i] || `Channel ${i + 1}`);
      const title = `${doc.name}, ${selectionOnly && doc.hasSelection ? `selection ${app.formatTime(start)} to ${app.formatTime(end)}` : 'entire file'}`;
      last = { rows: statsRows(result, n), names, title };
      caption.textContent = `Statistics for ${title}`;
      render();
      announce('Amplitude statistics ready');
    } catch (err) {
      caption.textContent = err.message === 'Cancelled' ? 'Scan cancelled.' : `Scan failed: ${err.message}`;
    } finally {
      abort = null;
      progress.hidden = true;
      refresh();
    }
  }

  async function copy() {
    if (!last) return;
    const lines = [last.title, ['', ...last.names].join('\t'), ...last.rows.map(([label, v]) => [label, ...(Array.isArray(v) ? v : [v])].join('\t'))];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      app.notify('Statistics copied.');
    } catch {
      app.notify('Copying is not allowed here.', { error: true });
    }
  }

  app.on('active', () => {
    last = null;
    caption.textContent = '';
    refresh();
  });
  app.on('doc-change', (doc, e) => doc === app.active && (e.kind === 'selection' || e.kind === 'edit' || e.kind === 'history') && refresh());
  refresh();
  return {
    el,
    show: refresh,
    focus: () => (scanAll.disabled ? scanSel : scanAll).focus(),
    scan: (selectionOnly) => scan(Boolean(selectionOnly)),
  };
}
