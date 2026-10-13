// Dialog views for Noise Reduction / Restoration effects: DeHummer's notch
// graph, the Sound Remover's model tools, focus buttons for DeNoise and
// DeReverb, and Advanced sections for the fine-tuning parameters.

import { h, announce } from '../../lib/dom.js';
import { registerEditor } from '../editors.js';
import { controlsFor, disclosure, radioChoice, vSlider, groupBox, glyph, enableWhen, checkbox } from '../layout.js';
import { responseEditor, spectrumMonitor } from './common.js';
import { learnSoundModel, MAX_SOUND_SECONDS } from '../defs/restoration.js';
import { downloadBlob, pickLocalFiles } from '../../storage/files.js';
import { encodeWav } from '../../audio/wav.js';
import { decodeAudio } from '../../audio/decode.js';

// DeHummer: the comb of hum notches, with a handle on the base notch
// (drag sideways for the hum frequency, down for depth; Alt+arrows or the
// wheel change Q).
const dehummer = responseEditor({
  label: 'Hum filter response',
  span: [-80, 6],
  step: 10,
  handles: (v) => [{ label: 'Base notch', freq: v.frequency, gain: v.gain, q: v.q, ids: { freq: 'frequency', gain: 'gain', q: 'q' } }],
});

// ------------------------------------------------------- DeNoise, DeReverb

/** Glyphs for the processing focus choices: all, lows, mids, highs. */
const focusIcons = () => ({
  0: glyph('M3 12h18'),
  1: glyph('M3 9h6l4 6h8'),
  2: glyph('M3 15h4l3-6h4l3 6h4'),
  3: glyph('M3 15h8l4-6h6'),
});

/**
 * Amount and focus on the left; on the right the gain fader under a
 * checkbox (DeNoise: output noise only; DeReverb: auto gain, which takes
 * over from the fader).
 */
const focusView = (extra, check) => {
  const view = (ctx) =>
    h(
      'div.fx-split.rs-focus',
      h('div.fx-stack', spectrumMonitor(ctx), radioChoice(ctx, 'focus', { icons: focusIcons(), className: 'fx-segmented' }), controlsFor(ctx, ['amount', ...extra])),
      groupBox('', checkbox(ctx, check), check === 'autoGain' ? enableWhen(ctx, vSlider(ctx, 'gain'), (v) => !v.autoGain) : vSlider(ctx, 'gain')),
    );
  view.hides = true;
  return view;
};

// ---------------------------------------------------------- Hiss Reduction

function hissView(ctx) {
  return h(
    'div.fx-stack',
    spectrumMonitor(ctx),
    controlsFor(ctx, ['noiseFloor', 'reduceBy', 'hissOnly']),
    disclosure('Advanced', controlsFor(ctx, ['decay', 'precision', 'transition', 'fftSize']), { prefs: ctx.app?.prefs, key: 'hissReduction' }),
  );
}
hissView.hides = true;

// ----------------------------------------------------------- Sound Remover

/**
 * Sound Remover: learn the model from the selection without leaving the
 * dialog, save it (the example sound, as a WAV file) and load one back
 * (relearned from the file's first seconds).
 */
function soundRemoverView(ctx) {
  const { app, doc } = ctx;
  const status = h('span.nr-status', { 'aria-live': 'polite' });
  const show = () => {
    const m = doc?.soundModel;
    status.textContent = m ? `Sound model: ${m.seconds.toFixed(m.seconds < 10 ? 2 : 1)} s example, ${m.bases.k} components` : 'Sound model: none';
    save.disabled = !m;
  };
  const learn = h('button.btn', {
    type: 'button',
    disabled: !doc,
    title: 'Learn the sound from the current selection (the sound only)',
    onclick: async () => {
      learn.disabled = true;
      try {
        await app.commands.run('fx.learnSoundModel');
      } finally {
        learn.disabled = !doc;
      }
    },
  }, 'Learn Sound Model');
  const save = h('button.icon-btn', {
    type: 'button',
    'aria-label': 'Save the sound model as a WAV file',
    title: 'Save the sound model (its example sound) as a WAV file',
    onclick: () => {
      const m = doc?.soundModel;
      if (m) downloadBlob(encodeWav({ sampleRate: m.rate, channels: [m.samples], bitDepth: 32 }), `${(doc.name || 'sound').replace(/\.[^.]+$/, '')} sound model.wav`);
    },
  }, glyph(['M12 3v12', 'M7 10l5 5 5-5', 'M4 19h16']));
  const load = h('button.icon-btn', {
    type: 'button',
    disabled: !doc,
    'aria-label': 'Load a sound model from an audio file',
    title: `Load a sound model: learns from the first ${MAX_SOUND_SECONDS} s of an audio file`,
    onclick: async () => {
      const [file] = await pickLocalFiles({ multiple: false });
      if (!file) return;
      try {
        const r = await decodeAudio(await file.arrayBuffer(), file.name);
        const n = Math.min(r.channels[0].length, Math.round(MAX_SOUND_SECONDS * r.sampleRate));
        doc.soundModel = await learnSoundModel(r.channels.map((c) => c.subarray(0, n)), r.sampleRate, ctx.values);
        doc.emit('change', { kind: 'soundModel' });
        announce('Sound model loaded');
      } catch (err) {
        app.notify(err?.message || 'Could not load a sound model from that file.', { error: true });
      }
    },
  }, glyph('M3 7h6l2 2h10v10H3z'));
  const off = doc?.on?.('change', (e) => e?.kind === 'soundModel' && show());
  if (off) ctx.onClose?.(off);
  show();
  return h(
    'div.fx-stack',
    h('div.nr-bar', learn, save, load, status),
    groupBox('Sound Model', controlsFor(ctx, ['complexity', 'passes'])),
    groupBox('Removal', controlsFor(ctx, ['strength', 'reduceBy', 'sensitivity', 'contentComplexity'])),
    controlsFor(ctx, ['speech', 'fftSize']),
  );
}
soundRemoverView.hides = true;

// Automatic Phase Correction: manual channel shifts apply while the automatic time shift is off.
function phaseView(ctx) {
  return h(
    'div.fx-stack',
    controlsFor(ctx, ['globalShift']),
    enableWhen(ctx, controlsFor(ctx, ['leftShift', 'rightShift']), (v) => !v.globalShift),
    controlsFor(ctx, ['alignBands', 'centerPan', 'channel', 'resolution', 'analysisSize']),
  );
}
phaseView.hides = true;

registerEditor('dehummer', dehummer);
registerEditor('autoPhaseCorrection', phaseView);
registerEditor('denoise', focusView([], 'noiseOnly'));
registerEditor('dereverb', focusView(['decay'], 'autoGain'));
registerEditor('hissReduction', hissView);

// Adaptive Noise Reduction: the live spectrum over the generated controls.
const adaptiveView = (ctx) => spectrumMonitor(ctx);
registerEditor('adaptiveNoiseReduction', adaptiveView);
registerEditor('soundRemover', soundRemoverView);
