// Distortion dialog: the positive and negative half-wave curves side by side
// as editable graphs (level into the curve in, level out, both in dB).
// A preset curve shows as points along its shape; dragging, adding or
// removing a point turns that half into a drawn curve. Between the graphs:
// link (symmetric) and copy buttons.

import { h } from '../../lib/dom.js';
import { cssVar } from '../../ui/theme.js';
import { icon } from '../../ui/icons.js';
import { envelopeControl, registerEditor } from '../editors.js';
import { controlsFor, groupBox, glyph, enableWhen } from '../layout.js';
import { DRAWN, DRAWN_FLOOR } from '../defs/special.js';

const LO = DRAWN_FLOOR;

/** Rational tanh as the shaper computes it (fx/special/shaper.rs fast_tanh). */
function fastTanh(x) {
  if (x >= 3) return 1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

/** Output magnitude of a preset curve for input magnitude a (mirrors shaper.rs curve). */
export function presetCurve(kind, a) {
  switch (kind) {
    case 1:
      return fastTanh(a);
    case 2:
      return Math.min(a, 1);
    case 3:
      return 1 - 1 / (1 + a * (1 + a * (0.5 + a / 6)));
    case 4:
      return a / Math.sqrt(Math.sqrt(1 + a ** 4));
    case 5:
      return Math.sin((a * Math.PI) / 2) / (Math.PI / 2);
    case 6:
      return 0;
    default:
      return a;
  }
}

const toDb = (a) => Math.max(LO, 20 * Math.log10(Math.max(1e-9, a)));
const SAMPLE_AT = [-60, -48, -36, -24, -18, -12, -9, -6, -4, -2, -1, 0];

/**
 * Points along a preset curve driven by `driveDb` (input level to output
 * level), for showing it and as the start of a drawn one.
 */
export function presetPoints(kind, driveDb = 0) {
  return SAMPLE_AT.map((x) => ({ x, y: Math.round(toDb(presetCurve(kind, 10 ** ((x + driveDb) / 20))) * 10) / 10 }));
}

/**
 * The curve one half uses: kind, whether it is drawn, and its points. Preset
 * curves show their response to the drive; drawn points are the curve the
 * driven signal meets.
 */
function halfState(v, side) {
  const mirrored = side === 'negative' && v.symmetric;
  const kind = mirrored ? v.positive : v[side];
  const drawn = kind === DRAWN;
  const points = drawn ? (mirrored || side === 'positive' ? v.posCurve : v.negCurve) : presetPoints(kind, v.drive);
  return { kind, drawn, points, mirrored };
}

function curveGraph(ctx, side) {
  const toEnv = (pts) => pts.map((p) => ({ t: (p.x - LO) / -LO, v: p.y }));
  let editing = false;
  let shown = JSON.stringify(halfState(ctx.values, side).points);
  const env = envelopeControl({
    param: { id: side, label: side === 'positive' ? 'Positive curve' : 'Negative curve', min: LO, max: 0, step: 0.1, unit: 'dB' },
    value: toEnv(halfState(ctx.values, side).points),
    xLabel: (t) => `${(LO + t * -LO).toFixed(1)} dB in`,
    pointText: (pt) => `In ${(LO + pt.t * -LO).toFixed(1)} dB, out ${pt.v.toFixed(1)} dB`,
    xTicks: [-50, -40, -30, -20, -10].map((d) => (d - LO) / -LO),
    xTickLabels: ['-50', '', '-30', '', '-10'],
    yTicks: [-50, -40, -30, -20, -10],
    className: 'dist-graph',
    onChange: (pts) => {
      const next = pts.map((p) => ({ x: Math.round((LO + p.t * -LO) * 10) / 10, y: Math.round(p.v * 10) / 10 }));
      const wasDrawn = halfState(ctx.values, side).drawn;
      shown = JSON.stringify(next);
      editing = true;
      // Editing the mirrored negative half breaks the link.
      if (side === 'negative' && ctx.values.symmetric) ctx.set('symmetric', false);
      ctx.set(side === 'positive' ? 'posCurve' : 'negCurve', next);
      ctx.set(side, DRAWN);
      // A preset curve was shown with its drive applied, so its drawn copy
      // already includes the drive: take the drive out once no preset half needs it.
      const other = side === 'positive' ? 'negative' : 'positive';
      if (!wasDrawn && (ctx.values.symmetric || halfState(ctx.values, other).drawn)) ctx.set('drive', 0);
      editing = false;
    },
    overlay: (g, W, H, { yOf }) => {
      // Unity line, and the effective curve when Curve Smoothing blends it toward a soft saturation.
      g.strokeStyle = cssVar('--grid-strong');
      g.setLineDash([3, 3]);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, yOf(LO, H));
      g.lineTo(W, yOf(0, H));
      g.stroke();
      g.setLineDash([]);
      // The response the input actually gets, when smoothing or (for drawn curves) the drive changes it.
      const v = ctx.values;
      const smooth = v.curveSmoothing / 100;
      const st = halfState(v, side);
      if (!smooth && !(st.drawn && v.drive)) return;
      g.strokeStyle = cssVar('--hot');
      g.globalAlpha = 0.7;
      g.lineWidth = 1.5;
      g.beginPath();
      for (let i = 0; i <= 120; i++) {
        const xDb = LO + (-LO * i) / 120;
        const a = 10 ** ((xDb + v.drive) / 20);
        const y0 = st.drawn ? 10 ** (interp(st.points, xDb + v.drive) / 20) : presetCurve(st.kind, a);
        const y = y0 + (fastTanh(a) - y0) * smooth;
        const px = (i / 120) * W;
        const py = yOf(toDb(y), H);
        if (i) g.lineTo(px, py);
        else g.moveTo(px, py);
      }
      g.stroke();
      g.globalAlpha = 1;
    },
  });
  const caption = h('div.dist-caption.faint');
  const update = () => {
    const st = halfState(ctx.values, side);
    caption.textContent = st.mirrored
      ? 'Mirrors the positive curve'
      : st.drawn
        ? ctx.values.drive
          ? `Drawn curve; the drive adds ${ctx.values.drive.toFixed(1)} dB before it (thin line)`
          : 'Drawn curve'
        : 'Drag a point to draw your own curve';
    env.classList.toggle('dist-mirrored', st.mirrored);
    if (editing) return;
    const now = JSON.stringify(st.points);
    if (now !== shown) {
      shown = now;
      env.setPoints(toEnv(st.points));
    } else env.redraw();
  };
  ctx.subscribe(update);
  update();
  const kindRow = enableWhen(ctx, controlsFor(ctx, [side], { labels: { [side]: 'Curve' } }), (v) => side === 'positive' || !v.symmetric);
  return groupBox(side === 'positive' ? 'Positive' : 'Negative', env, caption, kindRow);
}

/** Output dB of drawn points at input xDb (straight in dB between points). */
function interp(points, xDb) {
  const p = [...points].sort((a, b) => a.x - b.x);
  if (xDb <= p[0].x) return xDb + (p[0].y - p[0].x);
  for (let i = 1; i < p.length; i++) {
    if (xDb <= p[i].x) return p[i - 1].y + ((p[i].y - p[i - 1].y) * (xDb - p[i - 1].x)) / (p[i].x - p[i - 1].x || 1);
  }
  return p[p.length - 1].y;
}

function distortionView(ctx) {
  const linkBtn = h('button.icon-btn.dist-link', {
    type: 'button',
    'aria-label': 'Link the negative curve to the positive one',
    title: 'Link: the negative half mirrors the positive curve',
    onclick: () => ctx.set('symmetric', !ctx.values.symmetric),
  }, icon('link', 16));
  const copy = (from, to) => {
    const st = halfState(ctx.values, from);
    if (to === 'negative') ctx.set('symmetric', false);
    ctx.set(to === 'positive' ? 'posCurve' : 'negCurve', st.points);
    ctx.set(to, st.drawn ? DRAWN : st.kind);
  };
  const toNeg = h('button.icon-btn', { type: 'button', 'aria-label': 'Copy the positive curve to the negative half', title: 'Copy positive to negative', onclick: () => copy('positive', 'negative') }, glyph('M9 6l6 6-6 6', 16));
  const toPos = h('button.icon-btn', { type: 'button', 'aria-label': 'Copy the negative curve to the positive half', title: 'Copy negative to positive', onclick: () => copy('negative', 'positive') }, glyph('M15 6l-6 6 6 6', 16));
  ctx.subscribe((v) => linkBtn.setAttribute('aria-pressed', String(Boolean(v.symmetric))));
  linkBtn.setAttribute('aria-pressed', String(Boolean(ctx.values.symmetric)));
  const graphs = h('div.dist-graphs', curveGraph(ctx, 'positive'), h('div.dist-tools', linkBtn, toNeg, toPos), curveGraph(ctx, 'negative'));
  const settings = h(
    'div.fx-split.fx-split-even',
    groupBox('Settings', controlsFor(ctx, ['drive', 'curveSmoothing', 'timeSmoothing', 'mix', 'output'])),
    groupBox('Post Filter', controlsFor(ctx, ['filter', 'filterType', 'filterFreq', 'filterQ'], { labels: { filter: 'Filter the Output' } })),
  );
  return h('div.fx-stack', graphs, settings);
}
distortionView.hides = true;
distortionView.dialogClass = 'fx-wide';

registerEditor('distortion', distortionView);
