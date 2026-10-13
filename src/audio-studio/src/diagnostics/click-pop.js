// Click/Pop Eliminator dialog: scans the selection (or the file) for clicks
// with the DeClicker's detector, draws every detection on a graph of
// strength over time with a draggable repair threshold, lists them with
// times and lets you choose which to repair. Repair rebuilds the chosen
// clicks (least-squares AR interpolation) as one undo step and keeps the
// dialog open with what is left; Scan runs again with new settings.
//
// Built on the Diagnostics scan and repair (scan.js), which run in the
// diagnostics worker. Click strength is the residual peak in multiples of
// the detection level, so 1x is the weakest click the sensitivity finds; the
// repair threshold is 1 + Discrimination / 100.

import { h, announce } from '../lib/dom.js';
import { cssVar } from '../ui/theme.js';
import { openDialog } from '../ui/dialog.js';
import { getEffect } from '../effects/registry.js';
import { normalizeValues } from '../effects/params.js';
import { lastValues, rememberValues } from '../effects/presets.js';
import { paramControls } from '../effects/dialog.js';
import { plot, gridLines, labelText } from '../effects/editors.js';
import { scanProblems, repairClicks } from './scan.js';

export const EFFECT_ID = 'clickPopEliminator';

/** Repair threshold (strength multiple) for a Discrimination value. */
export const thresholdOf = (values) => 1 + (values.discrimination || 0) / 100;

/** Discrimination for a repair threshold. */
export const discriminationOf = (threshold) => Math.round((threshold - 1) * 100);

/** Detections at or above the threshold: the default choice after a scan or a threshold change. */
export function chooseByThreshold(problems, threshold) {
  return new Set(problems.filter((p) => p.level >= threshold).map((p) => p.id));
}

/**
 * Opens the dialog for `doc`. Resolves when it closes; `options.runner` and
 * `options.autoScan` exist for tests.
 */
export function openClickPopDialog(app, doc, { runner = null, autoScan = true } = {}) {
  const def = getEffect(EFFECT_ID);
  const discParam = def.params.find((p) => p.id === 'discrimination');
  const maxThreshold = thresholdOf({ discrimination: discParam.max });
  let values = normalizeValues(def, lastValues(app.prefs, def));
  let scan = null; // { state, range, problems, values }
  let chosen = new Set();
  let busy = null;
  let focusIndex = 0;

  // ------------------------------------------------------------- settings
  const settings = paramControls(def, () => values, (id, v) => {
    values = normalizeValues(def, { ...values, [id]: v });
    settings.refresh(values, id);
    if (id === 'discrimination' && scan) chosen = chooseByThreshold(scan.problems, thresholdOf(values));
    else if (id !== 'discrimination' && scan) caption.textContent = 'Settings changed: scan again to update the list.';
    render();
  });

  // ---------------------------------------------------------------- graph
  const yMax = () => Math.max(maxThreshold * 1.5, ...(scan?.problems || []).map((p) => p.level * 1.15));
  const yOf = (v, H) => H - 4 - (Math.log(Math.max(1, v)) / Math.log(yMax())) * (H - 12);
  const graph = plot('cpe-graph', 'Detected clicks by strength over time', (g, W, H) => {
    const top = yMax();
    const ticks = [1, 2, 5, 10, 20, 50, 100, 200, 500].filter((v) => v <= top);
    gridLines(g, W, H, [], ticks.map((v) => yOf(v, H)));
    ticks.forEach((v) => labelText(g, `${v}x`, 3, yOf(v, H) - 14));
    if (scan) {
      const [a, b] = scan.range;
      const span = Math.max(1, b - a);
      for (const p of scan.problems) {
        const x = Math.round(((p.start - a) / span) * (W - 2)) + 1.5;
        g.strokeStyle = chosen.has(p.id) ? cssVar('--hot') : cssVar('--text-faint');
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(x, H);
        g.lineTo(x, yOf(p.level, H));
        g.stroke();
      }
    }
    const ty = Math.round(yOf(thresholdOf(values), H)) + 0.5;
    g.strokeStyle = cssVar('--accent');
    g.setLineDash([5, 3]);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, ty);
    g.lineTo(W, ty);
    g.stroke();
    g.setLineDash([]);
  });
  const handle = h('button.fx-handle.cpe-threshold', { type: 'button', role: 'slider', 'aria-label': 'Repair threshold', title: 'Drag to choose the weakest click to repair. Arrows move it.' });
  graph.layer.append(handle);
  const setThreshold = (t) => {
    const disc = Math.min(discParam.max, Math.max(0, discriminationOf(t)));
    if (disc === values.discrimination) return;
    values = { ...values, discrimination: disc };
    settings.refresh(values, 'discrimination');
    if (scan) chosen = chooseByThreshold(scan.problems, thresholdOf(values));
    render();
  };
  const fromY = (clientY) => {
    const r = graph.el.getBoundingClientRect();
    const H = r.height || 1;
    const fr = Math.min(1, Math.max(0, (H - 4 - (clientY - r.top)) / (H - 12)));
    return Math.exp(fr * Math.log(yMax()));
  };
  graph.el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.focus();
    graph.el.setPointerCapture?.(e.pointerId);
    setThreshold(fromY(e.clientY));
    const move = (ev) => setThreshold(fromY(ev.clientY));
    const up = () => {
      graph.el.removeEventListener('pointermove', move);
      graph.el.removeEventListener('pointerup', up);
      graph.el.removeEventListener('pointercancel', up);
    };
    graph.el.addEventListener('pointermove', move);
    graph.el.addEventListener('pointerup', up);
    graph.el.addEventListener('pointercancel', up);
  });
  handle.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    setThreshold(thresholdOf(values) + d * (e.shiftKey ? 0.5 : 0.05));
  });

  // ----------------------------------------------------------------- list
  const body = h('tbody');
  const allBox = h('input', { type: 'checkbox', 'aria-label': 'Repair all detected clicks' });
  allBox.addEventListener('change', () => {
    if (!scan) return;
    chosen = allBox.checked ? new Set(scan.problems.map((p) => p.id)) : new Set();
    render();
  });
  const table = h(
    'table.data-table.cpe-table',
    { role: 'grid', 'aria-label': 'Detected clicks' },
    h('thead', h('tr', h('th.cpe-check', { scope: 'col' }, allBox), h('th.num', { scope: 'col' }, '#'), h('th', { scope: 'col' }, 'Time'), h('th', { scope: 'col' }, 'Length'), h('th', { scope: 'col' }, 'Channel'), h('th.num', { scope: 'col' }, 'Strength'))),
    body,
  );
  const progress = h('div.analysis-progress', { role: 'progressbar', 'aria-label': 'Click/Pop Eliminator progress', 'aria-valuemin': '0', 'aria-valuemax': '100', hidden: true }, h('div.analysis-progress-bar'));
  const caption = h('div.cpe-caption', { 'aria-live': 'polite' });
  const scanBtn = h('button.btn', { type: 'button', onclick: () => runScan() }, 'Scan');
  const cancelBtn = h('button.btn', { type: 'button', hidden: true, onclick: () => busy?.abort() }, 'Cancel');

  const timeText = (f) => (app.formatTime ? app.formatTime(f, doc.sampleRate) : `${(f / doc.sampleRate).toFixed(3)} s`);
  const chanText = (p) => (doc.channelCount === 1 ? 'Mono' : p.channels.length >= doc.channelCount ? 'All' : p.channels.map((c) => (doc.channelCount === 2 ? (c === 0 ? 'L' : 'R') : String(c + 1))).join(', '));

  function show(p) {
    doc.setSelection(p.start, Math.max(p.end, p.start + 1));
    doc.setCursor?.(p.start);
    const want = Math.max((p.end - p.start) * 40, doc.sampleRate * 0.05);
    const mid = (p.start + p.end) / 2;
    doc.setView?.(mid - want / 2, mid + want / 2);
  }

  function toggle(p) {
    chosen = new Set(chosen);
    if (chosen.has(p.id)) chosen.delete(p.id);
    else chosen.add(p.id);
    render();
  }

  function rowKeys(e, i) {
    const n = scan?.problems.length || 0;
    const go = (j) => {
      focusIndex = Math.max(0, Math.min(n - 1, j));
      show(scan.problems[focusIndex]);
      renderRows();
      body.children[focusIndex]?.focus();
    };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(n - 1);
    else if (e.key === ' ') toggle(scan.problems[i]);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  function renderRows() {
    if (!scan) {
      body.replaceChildren(h('tr', h('td.empty-row', { colspan: '6' }, h('span.empty-text', 'Scan to find clicks and pops.'))));
      return;
    }
    if (!scan.problems.length) {
      body.replaceChildren(h('tr', h('td.empty-row', { colspan: '6' }, h('span.empty-text', 'No clicks found. Raise the sensitivity and scan again.'))));
      return;
    }
    body.replaceChildren(
      ...scan.problems.map((p, i) => {
        const box = h('input', { type: 'checkbox', checked: chosen.has(p.id), tabindex: '-1', 'aria-label': `Repair click ${i + 1}`, onclick: (e) => e.stopPropagation(), onchange: () => toggle(p) });
        return h(
          'tr',
          {
            tabindex: i === focusIndex ? '0' : '-1',
            'aria-selected': String(chosen.has(p.id)),
            onclick: () => {
              focusIndex = i;
              show(p);
              renderRows();
            },
            onkeydown: (e) => rowKeys(e, i),
          },
          h('td.cpe-check', box),
          h('td.num', String(i + 1)),
          h('td.tabular', timeText(p.start)),
          h('td.tabular', `${p.end - p.start} smp`),
          h('td', chanText(p)),
          h('td.num', `${p.level.toFixed(1)}x`),
        );
      }),
    );
  }

  let repairBtn = null;
  function render() {
    renderRows();
    const n = scan?.problems.length || 0;
    const k = chosen.size;
    allBox.checked = n > 0 && k === n;
    allBox.indeterminate = k > 0 && k < n;
    allBox.disabled = !n || Boolean(busy);
    const t = thresholdOf(values);
    graph.redraw();
    const H = graph.el.clientHeight || 120;
    handle.style.left = 'calc(100% - 14px)';
    handle.style.top = `${yOf(t, H)}px`;
    handle.setAttribute('aria-valuenow', t.toFixed(2));
    handle.setAttribute('aria-valuetext', `${t.toFixed(2)} times the detection level`);
    scanBtn.textContent = scan ? 'Scan Again' : 'Scan';
    scanBtn.disabled = Boolean(busy);
    cancelBtn.hidden = !busy;
    if (repairBtn) {
      repairBtn.textContent = k ? `Repair ${k} Click${k === 1 ? '' : 's'}` : 'Repair';
      repairBtn.disabled = Boolean(busy) || !k;
    }
  }

  const setProgress = (f) => {
    const pct = Math.round(f * 100);
    progress.firstChild.style.width = `${pct}%`;
    progress.setAttribute('aria-valuenow', String(pct));
  };

  async function runScan() {
    if (busy) return;
    const range = doc.editRange();
    if (range[1] <= range[0]) return;
    busy = new AbortController();
    const signal = busy.signal;
    progress.hidden = false;
    setProgress(0);
    caption.textContent = `Scanning ${doc.hasSelection ? 'the selection' : 'the file'}...`;
    render();
    try {
      const state = doc.state;
      const mask = doc.channelMask;
      const r = await scanProblems({ effect: 'declicker', values: { ...values, discrimination: 0 }, channels: state.channels, rate: doc.sampleRate, start: range[0], end: range[1], signal, onProgress: setProgress, runner });
      // Only channels that are enabled for editing are repaired.
      const problems = r.problems.map((p) => ({ ...p, channels: p.channels.filter((c) => !mask || mask[c]) })).filter((p) => p.channels.length);
      scan = { state, range, problems, values: { ...values } };
      chosen = chooseByThreshold(problems, thresholdOf(values));
      focusIndex = 0;
      caption.textContent = problems.length ? `${problems.length} click${problems.length === 1 ? '' : 's'} found; ${chosen.size} at or above the repair threshold.` : 'No clicks found.';
      announce(caption.textContent);
    } catch (err) {
      caption.textContent = signal.aborted || err?.name === 'AbortError' ? 'Scan cancelled.' : `Scan failed: ${err.message}`;
    } finally {
      busy = null;
      progress.hidden = true;
      render();
    }
  }

  async function repair() {
    if (busy || !scan) return;
    if (doc.state !== scan.state) {
      caption.textContent = 'The file changed since the scan. Scan again before repairing.';
      return;
    }
    const list = scan.problems.filter((p) => chosen.has(p.id));
    if (!list.length) return;
    busy = new AbortController();
    const signal = busy.signal;
    progress.hidden = false;
    setProgress(0);
    render();
    try {
      const next = await repairClicks(doc.state, list, { ...scan.values, discrimination: 0 }, { runner, signal, onProgress: setProgress });
      if (signal.aborted) throw new Error('Cancelled');
      if (doc.state !== scan.state) {
        caption.textContent = 'The file changed while repairing. Nothing was changed.';
        return;
      }
      doc.apply(`${def.name.replace(/ \(process\)$/, '')}: Repair ${list.length} click${list.length === 1 ? '' : 's'}`, next);
      rememberValues(app.prefs, def, values);
      const done = new Set(list.map((p) => p.id));
      scan = { ...scan, state: doc.state, problems: scan.problems.filter((p) => !done.has(p.id)) };
      chosen = new Set();
      focusIndex = 0;
      caption.textContent = `Repaired ${list.length} click${list.length === 1 ? '' : 's'}.${scan.problems.length ? ` ${scan.problems.length} left below the threshold or unchosen.` : ''}`;
      announce(caption.textContent);
      app.setStatus?.(caption.textContent);
    } catch (err) {
      caption.textContent = signal.aborted || err?.message === 'Cancelled' ? 'Cancelled. Nothing was changed.' : `Repair failed: ${err.message}`;
    } finally {
      busy = null;
      progress.hidden = true;
      render();
    }
  }

  const el = h(
    'div.cpe-dialog-body',
    h('div.cpe-graph-wrap', graph.el),
    h('div.panel-toolbar.cpe-toolbar', scanBtn, cancelBtn, h('span.cpe-hint.faint', 'Drag the dashed line to set the repair threshold.')),
    progress,
    caption,
    h('div.table-scroll.cpe-list', table),
    h('details.cpe-settings', { open: true }, h('summary', 'Detection Settings'), settings.el),
  );

  const promise = openDialog({
    title: def.name.replace(/ \(process\)$/, ''),
    className: 'fx-dialog.cpe-dialog',
    wide: true,
    body: el,
    buttons: [
      { label: 'Close', value: null },
      { label: 'Repair', value: 'repair', primary: true },
    ],
    onSubmit: async (v) => {
      if (v === 'repair') await repair();
      return false; // stays open; Close (null) skips onSubmit
    },
    initialFocus: '.cpe-toolbar .btn',
  }).then(() => {
    busy?.abort();
  });
  repairBtn = el.closest('.dialog')?.querySelector('.dialog-foot button[data-value="repair"]') || null;
  render();
  if (autoScan) runScan();
  return Object.assign(promise, { scan: () => runScan(), repair: () => repair(), state: () => ({ scan, chosen, values }) });
}
