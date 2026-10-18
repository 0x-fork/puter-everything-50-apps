/**
 * Video from a description, or from a picture, through Puter AI
 * (puter.ai.txt2vid). A clip can start from a picture (image to video),
 * end on one (a bridge between two shots), or both.
 *
 * The provider's address for the clip is temporary and may not allow the
 * browser to read it, so the clip is written into the app's own folder in
 * Puter first (puter_output_path), read from there and the copy removed;
 * where that is refused, the address is read directly.
 *
 * txt2vid, the file system and fetch are injectable for tests.
 */
import { dataUrlToBlob } from './imagegen.js';
import { blobToDataUri } from './restyle.js';
import { errorMessage } from './transcribe.js';

export const VIDEO_PROMPT_MAX = 1500;

/**
 * The video models offered in the assistant's settings. t2v is used for a
 * clip from words alone, i2v when a first frame goes with it. seconds:
 * the lengths the model makes ({ min, max } or a list of choices).
 */
export const VIDEO_MODELS = [
  {
    id: 'wan',
    label: 'Wan 2.7',
    hint: 'Balanced, 2 to 15 seconds',
    t2v: 'togetherai:wan-ai/wan2.7-t2v',
    i2v: 'togetherai:wan-ai/wan2.7-i2v',
    seconds: { min: 2, max: 15 },
    endFrame: 'i2v',
  },
  {
    id: 'seedance',
    label: 'Seedance 2.0 Mini',
    hint: 'Fast, 4 to 15 seconds',
    t2v: 'seedance-2-0-mini',
    i2v: 'seedance-2-0-mini',
    seconds: { min: 4, max: 15 },
    endFrame: 'i2v',
  },
  {
    id: 'veo',
    label: 'Veo 3.1 Lite',
    hint: 'With sound, 4, 6 or 8 seconds',
    t2v: 'togetherai:google/veo-3.1-lite',
    i2v: 'togetherai:google/veo-3.1-lite',
    seconds: [4, 6, 8],
    endFrame: 'i2v',
  },
];
export const DEFAULT_VIDEO_MODEL = 'wan';
export const DEFAULT_SECONDS = 5;

/** Frame sizes asked for, at 720p, by shape. Models that do not take a size use their own. */
export const VIDEO_ASPECTS = [
  { id: '16:9', w: 1280, h: 720 },
  { id: '9:16', w: 720, h: 1280 },
  { id: '1:1', w: 960, h: 960 },
  { id: '4:3', w: 960, h: 720 },
  { id: '3:4', w: 720, h: 960 },
];

export const videoModel = (id) => VIDEO_MODELS.find((m) => m.id === id) || VIDEO_MODELS[0];

/** The video shape closest to a width and height (a project's frame). */
export function videoAspectFor(width, height) {
  const r = width / height;
  return VIDEO_ASPECTS.reduce((best, a) => (Math.abs(Math.log(a.w / a.h / r)) < Math.abs(Math.log(best.w / best.h / r)) ? a : best), VIDEO_ASPECTS[0]);
}

/** A length the model makes: the nearest of its choices, or within its range. */
export function fitSeconds(model, seconds) {
  const m = typeof model === 'string' ? videoModel(model) : model;
  const want = Number.isFinite(Number(seconds)) && Number(seconds) > 0 ? Number(seconds) : DEFAULT_SECONDS;
  if (Array.isArray(m.seconds)) return m.seconds.reduce((best, s) => (Math.abs(s - want) < Math.abs(best - want) ? s : best), m.seconds[0]);
  return Math.round(Math.min(m.seconds.max, Math.max(m.seconds.min, want)));
}

/**
 * Options for puter.ai.txt2vid. firstFrame and lastFrame are data URIs (or
 * web addresses); a last frame without a first one is sent as the first, as
 * the models need one to end on another.
 */
export function txt2vidOptions({ prompt, model = DEFAULT_VIDEO_MODEL, seconds, aspect = '16:9', firstFrame = null, lastFrame = null, sound, negativePrompt = '', outputPath = null, testMode = false } = {}) {
  const m = videoModel(model);
  const a = VIDEO_ASPECTS.find((x) => x.id === aspect) || VIDEO_ASPECTS[0];
  const first = firstFrame || null;
  const out = {
    prompt: String(prompt || '').trim().slice(0, VIDEO_PROMPT_MAX),
    model: first ? m.i2v : m.t2v,
    seconds: fitSeconds(m, seconds),
    size: `${a.w}x${a.h}`,
  };
  if (first) out.input_reference = first;
  if (first && lastFrame && m.endFrame) out.last_frame = lastFrame;
  if (typeof sound === 'boolean') out.generate_audio = sound;
  const neg = String(negativePrompt || '').trim().slice(0, 500);
  if (neg) out.negative_prompt = neg;
  if (outputPath) out.puter_output_path = outputPath;
  if (testMode) out.test_mode = true;
  return out;
}

/** A user-facing message for a failed request, by the codes txt2vid gives. */
export function videoErrorMessage(err) {
  const code = String(err?.code || err?.error?.code || '');
  const why = String(err?.errorCode || err?.error?.errorCode || '');
  if (why === 'moderation_flagged' || code === 'moderation_flagged') return 'The request was declined by the content filter. Try a different description or picture.';
  if (code === 'insufficient_funds') return 'Your Puter balance is too low to make this video. A shorter clip may fit.';
  if (code === 'upstream_timeout') return 'The video took too long to make. Try again, or ask for a shorter clip.';
  if (code === 'upstream_failed') return 'The video service could not make this clip. Try again.';
  if (code === 'prompt_required') return 'Describe the video first.';
  if (code === 'network_error' || code === 'request_timeout' || err instanceof TypeError) return 'The AI service could not be reached. Check your connection and try again.';
  return errorMessage(err, "Couldn't make the video. Try again.");
}

/** A short file name from the description: "a fox in the snow" -> "a fox in the snow.mp4". */
export function videoFileName(prompt, type = 'video/mp4') {
  const stem = String(prompt || '').replace(/[\\/:*?"<>|\n\r]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ').slice(0, 48).trim();
  const ext = /webm/.test(type) ? 'webm' : /quicktime/.test(type) ? 'mov' : 'mp4';
  return `${stem || 'Generated video'}.${ext}`;
}

const isWriteRefusal = (err) => /^(access_denied|cannot_write_to_root|forbidden)$/.test(String(err?.code || err?.error?.code || ''));

/** The address of what txt2vid returned (an element, or an object with src). */
function sourceOf(result) {
  if (typeof result === 'string') return result;
  return result?.currentSrc || result?.src || result?.getAttribute?.('src') || '';
}

/** The clip's bytes: the saved copy when there is one, the data URI, or the address read directly. */
export async function videoBlobFrom(result, { savedPath = null, fs = null, fetchFn = globalThis.fetch } = {}) {
  let blob = null;
  if (savedPath && fs?.read) {
    try {
      blob = await fs.read(savedPath);
    } catch {
      blob = null;
    }
    // The copy has done its work once read: the media library stores its own.
    Promise.resolve(fs.delete?.(savedPath)).catch(() => {});
  }
  if (!blob?.size) {
    const src = sourceOf(result);
    if (!src) throw new Error('No video came back. Try again.');
    blob = dataUrlToBlob(src);
    if (!blob) {
      let res;
      try {
        res = await fetchFn(src, { mode: 'cors', credentials: 'omit' });
      } catch {
        throw new Error("The video was made but couldn't be downloaded.");
      }
      if (!res?.ok) throw new Error("The video was made but couldn't be downloaded.");
      blob = await res.blob();
    }
  }
  if (!blob?.size) throw new Error('The video came back empty.');
  const declared = String(result?.getAttribute?.('data-mime-type') || result?.dataset?.mimeType || '');
  if (blob.type && !blob.type.startsWith('video/') && blob.type !== 'application/octet-stream') throw new Error('The answer was not a video.');
  if (!blob.type || blob.type === 'application/octet-stream') blob = new Blob([blob], { type: declared.startsWith('video/') ? declared : 'video/mp4' });
  return blob;
}

/** A picture (Blob) as a data URI for input_reference / last_frame. */
export async function frameReference(picture) {
  if (!picture) return null;
  const blob = picture instanceof Blob ? picture : picture.blob;
  return blob ? blobToDataUri(blob) : null;
}

let tempSeq = 0;
const tempPath = () => `video-studio/.ai-temp/${Date.now().toString(36)}-${(++tempSeq).toString(36)}.mp4`;

const defaultTxt2vid = (options) => {
  if (typeof puter === 'undefined' || !puter.ai?.txt2vid) throw new Error('Video generation needs Puter.');
  return puter.ai.txt2vid(options);
};
const defaultFs = () => (typeof puter !== 'undefined' ? puter.fs : null);

/**
 * Make a clip: { blob, prompt, options }. opts are txt2vidOptions' (with
 * firstFrame / lastFrame as Blobs or { blob } pictures). Throws Errors with
 * readable messages.
 */
export async function generateVideo(opts = {}, { txt2vid = defaultTxt2vid, fs = defaultFs(), fetchFn } = {}) {
  const prompt = String(opts.prompt || '').trim();
  if (!prompt) throw new Error('Describe the video first.');
  const firstFrame = await frameReference(opts.firstFrame);
  const lastFrame = await frameReference(opts.lastFrame);
  const savedPath = fs?.read ? tempPath() : null;
  const base = { ...opts, prompt, firstFrame: firstFrame || lastFrame, lastFrame: firstFrame ? lastFrame : null };
  let options = txt2vidOptions({ ...base, outputPath: savedPath });
  let result;
  try {
    result = await txt2vid(options);
  } catch (err) {
    // A folder the service may not write to: asked again without the copy (it is refused before a clip is made).
    if (!savedPath || !isWriteRefusal(err)) throw new Error(videoErrorMessage(err), { cause: err });
    options = txt2vidOptions(base);
    try {
      result = await txt2vid(options);
    } catch (again) {
      throw new Error(videoErrorMessage(again), { cause: again });
    }
  }
  const blob = await videoBlobFrom(result, { savedPath: options.puter_output_path || null, fs, fetchFn });
  return { blob, prompt, options };
}
