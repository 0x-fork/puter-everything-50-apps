// Effects > Generate: Tones, Noise, Silence and Speech. Generated audio is
// inserted at the playhead or replaces the selection in the active file; with
// no audio file open, a new file is created. Tones and Noise dialogs reuse the
// effect parameter controls and preset storage (ids gen.tones / gen.noise).

import { h, announce } from '../lib/dom.js';
import { icon } from '../ui/icons.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { Channel } from '../audio/channel.js';
import { AudioFile } from '../model/audio-file.js';
import * as E from '../model/edits.js';
import { paramControls, inlinePrompt } from './dialog.js';
import { normalizeValues } from './params.js';
import { allPresets, savePreset, matchPreset, lastValues, rememberValues } from './presets.js';
import { generateTones, generateNoise, WAVEFORMS, NOISE_COLORS, NOISE_STYLES } from './generate.js';
import { withProgress } from './progress.js';
import { isAbort } from './apply.js';
import * as puter from '../storage/puter.js';
import { decodeAudio } from '../audio/decode.js';
import { dsp } from '../audio/dsp.js';
import { UserError } from '../lib/errors.js';

const audio = (app) => (app.active?.kind === 'audio' ? app.active : null);

const PLACEMENT = { id: 'placement', label: 'Placement', type: 'choice', options: [{ value: 'insert', label: 'Insert at Playhead' }, { value: 'replace', label: 'Replace Selection' }], default: 'replace' };

export const TONES_DEF = {
  id: 'gen.tones',
  name: 'Generate Tones',
  params: [
    { id: 'base', label: 'Base Frequency', min: 20, max: 22000, step: 1, default: 440, unit: 'Hz', scale: 'log' },
    { id: 'modulateBy', label: 'Modulate By', min: 0, max: 2000, step: 1, default: 0, unit: 'Hz' },
    { id: 'modFreq', label: 'Modulation Frequency', min: 0.1, max: 200, step: 0.1, default: 1, unit: 'Hz', scale: 'log' },
    { id: 'waveform', label: 'Waveform', type: 'choice', options: WAVEFORMS, default: 'sine' },
    ...[1, 2, 3, 4, 5].map((k) => ({ id: `c${k}`, label: k === 1 ? 'Fundamental' : `Harmonic ${k}`, min: 0, max: 100, step: 1, default: k === 1 ? 100 : 0, unit: '%', section: 'Frequency Components' })),
    { id: 'volume', label: 'Volume', min: -96, max: 0, step: 0.1, default: -6, unit: 'dB', section: 'Output' },
    { id: 'duration', label: 'Duration', min: 0.01, max: 3600, step: 0.01, default: 5, unit: 's', scale: 'log', section: 'Output' },
  ],
  presets: [
    { name: 'Default', values: { base: 440, modulateBy: 0, modFreq: 1, waveform: 'sine', c1: 100, c2: 0, c3: 0, c4: 0, c5: 0, volume: -6, duration: 5 } },
    { name: '1 kHz Reference at -18 dB', values: { base: 1000, waveform: 'sine', c1: 100, volume: -18, duration: 10 } },
    { name: 'Rich Organ Tone', values: { base: 220, waveform: 'sine', c1: 100, c2: 50, c3: 33, c4: 25, c5: 20, volume: -6, duration: 4 } },
    { name: 'Siren Sweep', values: { base: 800, modulateBy: 300, modFreq: 0.5, waveform: 'triangle', c1: 100, volume: -9, duration: 6 } },
    { name: 'Low Buzz', values: { base: 60, waveform: 'sawtooth', c1: 100, volume: -12, duration: 3 } },
  ],
};

export const NOISE_DEF = {
  id: 'gen.noise',
  name: 'Generate Noise',
  params: [
    { id: 'color', label: 'Color', type: 'choice', options: NOISE_COLORS, default: 'white' },
    { id: 'style', label: 'Style', type: 'choice', options: NOISE_STYLES, default: 'independent' },
    { id: 'intensity', label: 'Intensity', min: 0, max: 100, step: 1, default: 100, unit: '%' },
    { id: 'volume', label: 'Volume', min: -96, max: 0, step: 0.1, default: -12, unit: 'dB', section: 'Output' },
    { id: 'duration', label: 'Duration', min: 0.01, max: 3600, step: 0.01, default: 5, unit: 's', scale: 'log', section: 'Output' },
  ],
  presets: [
    { name: 'Default', values: { color: 'white', style: 'independent', intensity: 100, volume: -12, duration: 5 } },
    { name: 'Soft Pink Bed', values: { color: 'pink', intensity: 100, volume: -30, duration: 30 } },
    { name: 'Brown Rumble', values: { color: 'brown', intensity: 100, volume: -18, duration: 10 } },
    { name: 'Grey Masking Noise', values: { color: 'grey', intensity: 100, volume: -24, duration: 30 } },
  ],
};

export const SILENCE_DEF = {
  id: 'gen.silence',
  name: 'Generate Silence',
  params: [{ id: 'duration', label: 'Duration', min: 0.001, max: 3600, step: 0.001, default: 1, unit: 's', scale: 'log' }],
  presets: [],
};

/** Puts generated per-channel samples into the active file, or a new file when none is open. */
export function placeGenerated(app, outs, rate, { label, name, placement = 'replace' }) {
  const doc = audio(app);
  const n = outs[0]?.length || 0;
  if (!n) return null;
  if (!doc) {
    const count = app.prefs.get('defaultChannels') === 1 ? 1 : 2;
    const channels = Array.from({ length: count }, (_, i) => Channel.fromSamples(i < outs.length ? outs[i] : outs[0].slice()));
    const created = new AudioFile({ name: app.uniqueName(name), sampleRate: rate, channels });
    app.addDocument(created);
    created.setSelection(0, n);
    announce(`${label}: new file created`);
    return created;
  }
  const clip = { channels: E.conformChannels({ channels: outs.map((o) => Channel.fromSamples(o)) }, doc.channelCount) };
  const replace = placement === 'replace' && doc.hasSelection;
  const at = replace ? doc.selection.start : doc.cursor;
  const state = replace ? E.replaceRange(doc.state, doc.selection.start, doc.selection.end, clip, doc.channelMask) : E.insertClip(doc.state, at, clip, doc.channelMask);
  doc.apply(label, state, { selection: { start: at, end: at + n }, cursor: at });
  announce(`${label} inserted`);
  return doc;
}

/** Dialog for a generator pseudo-definition with presets; resolves values or null. */
async function generatorDialog(app, def, { withPlacement }) {
  const fullDef = withPlacement ? { ...def, params: [...def.params, { ...PLACEMENT, section: 'Output' }] } : def;
  let values = normalizeValues(fullDef, lastValues(app.prefs, fullDef));
  const presetSel = h('select.select.fx-preset-select', { 'aria-label': 'Presets' });
  const syncPresets = () => {
    const list = allPresets(app.prefs, def);
    const cur = matchPreset(app.prefs, def, values);
    presetSel.replaceChildren(...(cur ? [] : [h('option', { value: '' }, '(Custom)')]), ...list.map((p) => h('option', { value: p.name }, p.name)));
    presetSel.value = cur;
  };
  let controls;
  presetSel.addEventListener('change', () => {
    const p = allPresets(app.prefs, def).find((x) => x.name === presetSel.value);
    if (!p) return;
    values = normalizeValues(fullDef, { ...normalizeValues(def, p.values), placement: values.placement });
    controls.refresh(values);
  });
  controls = paramControls(fullDef, () => values, (id, v) => {
    values = normalizeValues(fullDef, { ...values, [id]: v });
    controls.refresh(values, id);
    syncPresets();
  });
  const nameRow = h('div.fx-namebar', { hidden: true });
  let dismiss = null;
  const saveBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Save settings as a preset', title: 'Save settings as a preset', onclick: () => {
    dismiss = inlinePrompt(nameRow, { label: 'Preset name:', value: 'My Preset', returnFocus: saveBtn, onSave: (n) => {
      savePreset(app.prefs, def, n, values);
      syncPresets();
    } });
  } }, icon('save', 15));
  syncPresets();
  const r = await openDialog({
    title: def.name,
    className: 'fx-dialog',
    body: h('div.fx-dialog-body', def.presets.length ? h('div.fx-presetbar', h('label.fx-label', 'Presets:'), presetSel, saveBtn) : null, nameRow, controls.el),
    buttons: [
      { label: 'Cancel', value: null },
      { label: 'OK', value: 'ok', primary: true },
    ],
    initialFocus: '.fx-params .hot, .fx-params select, .fx-params input',
  });
  dismiss?.();
  if (r !== 'ok') return null;
  rememberValues(app.prefs, fullDef, values);
  return values;
}

async function runGenerator(app, label, name, make, placement) {
  try {
    const { outs, rate } = await withProgress(app, label, async (signal) => {
      await new Promise((res) => setTimeout(res, 0));
      if (signal.aborted) return { outs: [], rate: 0 };
      return make();
    });
    return placeGenerated(app, outs, rate, { label, name, placement });
  } catch (err) {
    if (isAbort(err)) return null;
    throw err;
  }
}

const rateFor = (app) => audio(app)?.sampleRate || app.prefs.get('defaultRate') || 48000;
const channelsFor = (app) => audio(app)?.channelCount || (app.prefs.get('defaultChannels') === 1 ? 1 : 2);

export async function generateTonesCommand(app) {
  const v = await generatorDialog(app, TONES_DEF, { withPlacement: Boolean(audio(app)?.hasSelection) });
  if (!v) return null;
  const rate = rateFor(app);
  return runGenerator(app, 'Generate Tones', 'Tones', () => {
    const tone = generateTones({ rate, frames: Math.round(v.duration * rate), base: v.base, components: [v.c1, v.c2, v.c3, v.c4, v.c5].map((c) => c / 100), waveform: v.waveform, modulateBy: v.modulateBy, modFreq: v.modFreq, volumeDb: v.volume });
    return { outs: [tone], rate };
  }, v.placement);
}

export async function generateNoiseCommand(app) {
  const v = await generatorDialog(app, NOISE_DEF, { withPlacement: Boolean(audio(app)?.hasSelection) });
  if (!v) return null;
  const rate = rateFor(app);
  const seed = (Date.now() & 0x7fffffff) | 1;
  return runGenerator(app, 'Generate Noise', 'Noise', () => ({
    outs: generateNoise({ frames: Math.round(v.duration * rate), channels: channelsFor(app), color: v.color, intensity: v.intensity / 100, volumeDb: v.volume, style: v.style, seed }),
    rate,
  }), v.placement);
}

export async function generateSilenceCommand(app) {
  const v = await generatorDialog(app, SILENCE_DEF, { withPlacement: false });
  if (!v) return null;
  const rate = rateFor(app);
  return placeGenerated(app, [new Float32Array(Math.round(v.duration * rate))], rate, { label: 'Generate Silence', name: 'Silence', placement: 'insert' });
}

// ------------------------------------------------------------- speech

export const SPEECH_LANGUAGES = [
  { code: 'en-US', label: 'English (US)', voices: ['Joanna', 'Matthew', 'Ivy', 'Justin', 'Kendra', 'Kimberly', 'Salli', 'Joey'] },
  { code: 'en-GB', label: 'English (UK)', voices: ['Amy', 'Brian', 'Emma'] },
  { code: 'en-AU', label: 'English (Australia)', voices: ['Nicole', 'Russell'] },
  { code: 'es-ES', label: 'Spanish (Spain)', voices: ['Lucia', 'Enrique', 'Conchita'] },
  { code: 'es-US', label: 'Spanish (US)', voices: ['Lupe', 'Miguel', 'Penelope'] },
  { code: 'fr-FR', label: 'French', voices: ['Lea', 'Mathieu', 'Celine'] },
  { code: 'de-DE', label: 'German', voices: ['Vicki', 'Hans', 'Marlene'] },
  { code: 'it-IT', label: 'Italian', voices: ['Bianca', 'Giorgio', 'Carla'] },
  { code: 'pt-BR', label: 'Portuguese (Brazil)', voices: ['Camila', 'Vitoria', 'Ricardo'] },
  { code: 'nl-NL', label: 'Dutch', voices: ['Lotte', 'Ruben'] },
  { code: 'ja-JP', label: 'Japanese', voices: ['Mizuki', 'Takumi'] },
  { code: 'ko-KR', label: 'Korean', voices: ['Seoyeon'] },
  { code: 'cmn-CN', label: 'Chinese (Mandarin)', voices: ['Zhiyu'] },
  { code: 'hi-IN', label: 'Hindi', voices: ['Aditi'] },
];

export const NATURAL_VOICES = ['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'];

const MAX_SPEECH_CHARS = 3000;

/** txt2speech options for a voice choice "polly:Joanna" or "openai:nova". */
export function speechOptions(voiceChoice, language, neural) {
  const [provider, voice] = String(voiceChoice).split(':');
  if (provider === 'openai') return { provider: 'openai', model: 'gpt-4o-mini-tts', voice, response_format: 'wav' };
  return { provider: 'aws-polly', voice, language, engine: neural ? 'neural' : 'standard' };
}

/** Readable message from a Puter error (objects, strings or Errors). */
export function puterErrorMessage(err) {
  if (!err) return 'Unknown error.';
  if (typeof err === 'string') return err;
  return err.message || err.error?.message || err.error || (err.code ? `Error ${err.code}` : 'Unknown error.');
}

async function speechDialog(app) {
  const saved = app.prefs.get('speechSettings') || {};
  const text = h('textarea.input.speech-text', { rows: 5, 'aria-label': 'Text to speak', placeholder: 'Type the words to speak', maxLength: MAX_SPEECH_CHARS }, saved.text || '');
  const count = h('span.faint.tabular', { 'aria-live': 'off' });
  const updateCount = () => (count.textContent = `${text.value.length} / ${MAX_SPEECH_CHARS}`);
  text.addEventListener('input', updateCount);
  updateCount();
  const lang = h('select.select', { 'aria-label': 'Language' }, SPEECH_LANGUAGES.map((l) => h('option', { value: l.code, selected: l.code === (saved.language || 'en-US') }, l.label)));
  const voice = h('select.select', { 'aria-label': 'Voice' });
  const neural = h('input', { type: 'checkbox', checked: Boolean(saved.neural) });
  const neuralRow = h('label.check', neural, 'Neural quality (not every voice supports it)');
  const fillVoices = (keep) => {
    const l = SPEECH_LANGUAGES.find((x) => x.code === lang.value) || SPEECH_LANGUAGES[0];
    voice.replaceChildren(
      h('optgroup', { label: `${l.label} voices` }, l.voices.map((v) => h('option', { value: `polly:${v}` }, v))),
      h('optgroup', { label: 'Natural voices (any language)' }, NATURAL_VOICES.map((v) => h('option', { value: `openai:${v}` }, v[0].toUpperCase() + v.slice(1)))),
    );
    if (keep && [...voice.options].some((o) => o.value === keep)) voice.value = keep;
    neuralRow.hidden = voice.value.startsWith('openai:');
  };
  lang.addEventListener('change', () => fillVoices());
  voice.addEventListener('change', () => (neuralRow.hidden = voice.value.startsWith('openai:')));
  fillVoices(saved.voice);
  const doc = audio(app);
  const placement = doc?.hasSelection ? h('select.select', { 'aria-label': 'Placement' }, h('option', { value: 'replace' }, 'Replace Selection'), h('option', { value: 'insert' }, 'Insert at Playhead')) : null;
  const error = h('div.fx-name-error', { role: 'alert' });
  const r = await openDialog({
    title: 'Generate Speech',
    className: 'fx-dialog',
    body: h(
      'div.fx-dialog-body.speech-body',
      text,
      h('div.row', count, h('div.spacer'), h('span.faint', 'Uses Puter AI; requires a Puter account.')),
      h('div.form-grid', h('label', 'Language:'), lang, h('label', 'Voice:'), voice, h('span'), neuralRow, placement ? h('label', 'Placement:') : null, placement),
      error,
    ),
    buttons: [
      { label: 'Cancel', value: null },
      { label: 'Generate', value: 'ok', primary: true },
    ],
    initialFocus: 'textarea',
    onSubmit: () => {
      const t = text.value.trim();
      if (!t) {
        error.textContent = 'Type some text to speak.';
        return false;
      }
      if (t.length > MAX_SPEECH_CHARS) {
        error.textContent = `Text must be under ${MAX_SPEECH_CHARS} characters.`;
        return false;
      }
      return true;
    },
  });
  if (r !== 'ok') return null;
  const settings = { text: text.value, language: lang.value, voice: voice.value, neural: neural.checked };
  app.prefs.set('speechSettings', settings);
  return { ...settings, placement: placement?.value || 'insert' };
}

/** Fetches the audio behind an <audio> element returned by txt2speech and decodes it. */
async function decodeSpeech(el, signal) {
  const src = el?.src || el?.currentSrc || (typeof el === 'string' ? el : null);
  if (!src) throw new UserError('The speech service returned no audio.');
  let buffer;
  try {
    const res = await fetch(src, { signal });
    if (!res.ok) throw new Error(String(res.status));
    buffer = await res.arrayBuffer();
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new UserError('The generated speech could not be downloaded. Check your connection and try again.');
  }
  return decodeAudio(buffer, 'speech.mp3');
}

export async function generateSpeechCommand(app) {
  const sdk = puter.sdk();
  if (!sdk?.ai?.txt2speech) {
    app.notify('Speech generation needs Puter, which is not available. Check your connection and reload.', { error: true });
    return null;
  }
  if (!puter.isSignedIn()) {
    const ok = await confirmDialog({ title: 'Sign In to Generate Speech', message: 'Generating speech uses Puter AI and needs a free Puter account. Sign in now?', confirm: 'Sign In' });
    if (!ok) return null;
    try {
      if (!(await puter.signIn())) return null;
    } catch (err) {
      app.notify(`Sign-in did not complete: ${puterErrorMessage(err)}`, { error: true });
      return null;
    }
  }
  const s = await speechDialog(app);
  if (!s) return null;
  const targetRate = rateFor(app);
  try {
    const { outs, rate } = await withProgress(
      app,
      'Generating Speech',
      async (signal) => {
        let el;
        try {
          el = await sdk.ai.txt2speech(s.text.trim(), speechOptions(s.voice, s.language, s.neural));
        } catch (err) {
          throw new UserError(`Speech could not be generated: ${puterErrorMessage(err)}`);
        }
        const decoded = await decodeSpeech(el, signal);
        let chans = decoded.channels;
        if (decoded.sampleRate !== targetRate) {
          const d = await dsp();
          chans = chans.map((c) => d.resample(c, decoded.sampleRate, targetRate));
        }
        return { outs: chans, rate: targetRate };
      },
      { indeterminate: true, delay: 0 },
    );
    return placeGenerated(app, outs, rate, { label: 'Generate Speech', name: 'Speech', placement: s.placement });
  } catch (err) {
    if (isAbort(err)) return null;
    throw err;
  }
}

export function installGenerators(app) {
  app.commands.register([
    { id: 'gen.tones', label: 'Tones...', run: () => generateTonesCommand(app) },
    { id: 'gen.noise', label: 'Noise...', run: () => generateNoiseCommand(app) },
    { id: 'gen.silence', label: 'Silence...', run: () => generateSilenceCommand(app) },
    { id: 'gen.speech', label: 'Speech...', run: () => generateSpeechCommand(app) },
  ]);
}
