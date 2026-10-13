import { duotonePixels } from './picture-duotone.js';
import { colorChangePixels } from './picture-color-change.js';
import { imageWithPixelEffects } from './vector-image-effects.js';

export function luminancePixels(data, brightness, contrast) {
  if (![brightness, contrast].every(v => Number.isFinite(v) && v >= -1 && v <= 1)) throw new Error('Invalid picture brightness or contrast.');
  const scale = contrast <= 0 ? 1 + contrast : 1 / (1 - contrast);
  const lookup = Uint8Array.from({ length: 256 }, (_, value) => contrast === 1
    ? (value / 255 - .5 + brightness / 2 >= 0 ? 255 : 0)
    : Math.max(0, Math.min(255, Math.floor(value * scale + 127.5 * (1 - scale) + 127.5 * brightness * (1 + scale) + 1e-9))));
  for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) data[i + c] = lookup[data[i + c]];
  return data;
}

export function pictureEffectPixels(data, effects, mime) {
  for (const effect of effects) {
    if (Array.isArray(effect)) duotonePixels(data, [effect]);
    else if (effect?.type === 'luminance') luminancePixels(data, effect.brightness, effect.contrast);
    else if (effect?.type === 'colorChange') colorChangePixels(data, effect, mime);
    else throw new Error('Unsupported picture color effect.');
  }
  return data;
}

export function decodePictureEffects(image, effects, mime) {
  return imageWithPixelEffects(image, data => pictureEffectPixels(data, effects, mime));
}
