/**
 * File kinds and the device file picker: the small part of Place and drag
 * and drop that must run before the import code loads (a file input has to
 * be opened while the click that asked for it is still being handled).
 */
import { h } from '../../lib/dom.js';

export const RASTER_EXT = /\.(png|jpe?g|webp|gif)$/i;
export const PLACE_ACCEPT = '.svg,.svgz,image/svg+xml,.png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif';

/** 'svg' | 'image' | 'document' | null for a File/Blob. */
export function fileKind(file) {
  const name = String(file?.name || '').toLowerCase();
  const type = String(file?.type || '').toLowerCase();
  if (name.endsWith('.vstudio') || type === 'application/x-vector-studio') return 'document';
  if (type === 'image/svg+xml' || name.endsWith('.svg') || name.endsWith('.svgz')) return 'svg';
  if (/^image\/(png|jpeg|webp|gif)$/.test(type) || RASTER_EXT.test(name)) return 'image';
  return null;
}

/** Open the device file picker for Place. Resolves to the chosen files ([] when cancelled). */
export function pickDeviceFiles() {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', multiple: true, accept: PLACE_ACCEPT, style: { display: 'none' } });
    let settled = false;
    const done = (files) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => done([...input.files]));
    input.addEventListener('cancel', () => done([]));
    document.body.append(input);
    input.click();
  });
}

