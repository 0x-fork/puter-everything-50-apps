/**
 * Links panel: every placed image with its link information (name, format,
 * pixel size, effective resolution, placed size, scale, rotation, file
 * size, linked or embedded), and Relink, Go To Link, Update Link, Edit
 * Original and Embed. Images are always embedded in the document (so a file
 * opens anywhere); an image placed from Puter also keeps `node.link`
 * ({ source: 'puter', path, name, size, modified }) to its file, which
 * Update Link re-reads and Edit Original opens. Embed drops the link.
 */
import { h } from '../../lib/dom.js';
import { Panel } from '../../ui/panels/panel.js';
import { iconButton } from '../../ui/widgets.js';
import { icon } from '../../ui/icons.js';
import { UserError } from '../../lib/errors.js';
import { multiply, translate, scale as scaleM } from '../../lib/matrix.js';
import { nodeBounds } from '../../model/geometry.js';
import { formatBytes } from '../files/naming.js';
import { pickDeviceFiles } from '../io/kinds.js';

const FORMAT = { 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WebP', 'image/gif': 'GIF', 'image/svg+xml': 'SVG' };

/** Placed images in paint order. */
export function placedImages(doc) {
  const out = [];
  doc.walk((n) => {
    if (n.type === 'image') out.push(n);
    return true;
  });
  return out;
}

/** Facts about a placed image. Lengths in points, resolution in pixels per inch. */
export function imageInfo(doc, node) {
  const a = doc.assets.get(node.asset) || {};
  const m = node.transform || [1, 0, 0, 1, 0, 0];
  const sx = Math.hypot(m[0], m[1]);
  const sy = Math.hypot(m[2], m[3]);
  const bytes = a.data ? Math.round(((a.data.length - a.data.indexOf(',') - 1) * 3) / 4) : 0;
  return {
    name: node.link?.name || node.name || a.name || 'Image',
    format: FORMAT[a.mime] || (a.mime ? a.mime.replace(/^image\//, '').toUpperCase() : 'Unknown'),
    pixels: { w: node.width, h: node.height },
    placed: { w: node.width * sx, h: node.height * sy },
    ppi: { x: sx ? 72 / sx : 0, y: sy ? 72 / sy : 0 },
    scale: { x: sx * 100, y: sy * 100 },
    rotation: Math.round(((-Math.atan2(m[1], m[0]) * 180) / Math.PI) * 100) / 100 || 0,
    bytes,
    linked: Boolean(node.link),
    location: node.link?.path || null,
    missing: !a.data,
  };
}

/** New transform that fits an image of size (w, h) where `node` was, keeping its aspect ratio, centered. */
export function fitTransform(node, w, h) {
  const s = Math.min(node.width / w, node.height / h);
  return multiply(node.transform, multiply(translate((node.width - w * s) / 2, (node.height - h * s) / 2), scaleM(s)));
}

/** Swap the image of placed nodes for a new blob (one undo step). */
export async function replaceImage(app, editor, nodeIds, blob, { link = null, label = 'Relink' } = {}) {
  const doc = editor.doc;
  const io = await import('../io/lazy.js');
  const data = await io.imageNodeData(blob, { name: blob.name?.replace(/\.[^.]+$/, '') || '' });
  doc.assets.set(data.assetId, data.asset);
  doc.transact(label, () => {
    for (const id of nodeIds) {
      const n = doc.get(id);
      if (!n || n.type !== 'image') continue;
      doc.update(id, { asset: data.assetId, width: data.width, height: data.height, transform: fitTransform(n, data.width, data.height), link: link || undefined });
    }
  });
  return data;
}

async function pickImage(app) {
  if (app.user && app.puter?.ui?.showOpenFilePicker) {
    const source = await app.dialogs.open({
      title: 'Relink',
      body: h('p.dialog-message', 'Choose the replacement image.'),
      buttons: [{ label: 'Cancel', value: null }, { label: 'From This Device...', value: 'device' }, { label: 'From Puter...', value: 'puter', primary: true }],
    });
    if (!source) return null;
    if (source === 'puter') {
      const p = app.puter.ui.showOpenFilePicker({ multiple: false, accept: ['.png', '.jpg', '.jpeg', '.webp', '.gif'] });
      let item = await (p && p.undefinedOnCancel ? p.undefinedOnCancel : p);
      if (Array.isArray(item)) item = item[0];
      if (!item) return null;
      const blob = await item.read();
      const file = new File([blob], item.name || 'image', { type: blob.type });
      return { file, link: item.path ? { source: 'puter', path: item.path, name: item.name, size: blob.size, modified: Date.now() } : null };
    }
  }
  const [file] = await pickDeviceFiles();
  if (!file) return null;
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) && !/\.(png|jpe?g|webp|gif)$/i.test(file.name)) throw new UserError('Choose a PNG, JPEG, WebP or GIF image.');
  return { file, link: null };
}

export async function relink(app, editor, ids) {
  const picked = await pickImage(app);
  if (!picked) return false;
  await replaceImage(app, editor, ids, picked.file, { link: picked.link, label: 'Relink' });
  app.notify(`Relinked to ${picked.file.name}.`, { polite: true });
  return true;
}

/** Re-read linked files from Puter. Returns the number of images updated. */
export async function updateLinks(app, editor, ids) {
  const doc = editor.doc;
  const fs = app.puter?.fs;
  let n = 0;
  for (const id of ids) {
    const node = doc.get(id);
    if (!node?.link?.path) continue;
    if (!fs?.read) throw new UserError('Linked files can be updated when Vector Studio runs with Puter.');
    const blob = await fs.read(node.link.path);
    const file = new File([blob], node.link.name || 'image', { type: blob.type });
    await replaceImage(app, editor, [id], file, { link: { ...node.link, size: blob.size, modified: Date.now() }, label: 'Update Link' });
    n++;
  }
  return n;
}

export function embedImages(editor, ids) {
  const doc = editor.doc;
  const targets = ids.filter((id) => doc.get(id)?.link);
  if (!targets.length) return 0;
  doc.transact('Embed Image', () => targets.forEach((id) => doc.update(id, { link: undefined })));
  return targets.length;
}

export function goToLink(editor, id) {
  const doc = editor.doc;
  const n = doc.get(id);
  if (!n) return false;
  editor.select([id]);
  const b = nodeBounds(doc, n);
  if (b) {
    editor.view.centerOn(b.x + b.w / 2, b.y + b.h / 2);
    editor.viewChanged();
  }
  return true;
}

/**
 * Edit Original: open a Puter-linked image in Puter's image editor; any
 * other image is saved to the device to edit elsewhere and bring back with
 * Relink.
 */
export async function editOriginal(app, editor, id) {
  const doc = editor.doc;
  const n = doc.get(id);
  if (!n || n.type !== 'image') return false;
  if (n.link?.path && app.puter?.ui?.launchApp) {
    try {
      await app.puter.ui.launchApp({ name: 'photo-studio', file_paths: [n.link.path] });
      app.notify('Edit and save the image, then choose Update Link.', { polite: true });
      return true;
    } catch {
      // Fall back to saving a copy.
    }
  }
  const a = doc.assets.get(n.asset);
  if (!a?.data) throw new UserError('This image has no data to edit.');
  const info = imageInfo(doc, n);
  const ext = { PNG: 'png', JPEG: 'jpg', WebP: 'webp', GIF: 'gif' }[info.format] || 'png';
  const blob = await (await fetch(a.data)).blob();
  const { downloadBlob } = await import('../io/deliver.js');
  const name = `${String(info.name).replace(/\.[^.]+$/, '')}.${ext}`;
  downloadBlob(blob, name);
  app.notify(`Saved ${name}. Edit it, then use Relink to bring it back.`, { timeout: 6000 });
  return true;
}

const fmt = (v, d = 0) => (Number.isFinite(v) ? Number(v.toFixed(d)).toLocaleString() : '-');

export class LinksPanel extends Panel {
  static id = 'links';
  static title = 'Links';
  static icon = 'panel-links';
  static placement = 'strip';

  build() {
    this.selectedId = null;
    this.list = h('ul.lk-list', { role: 'listbox', tabindex: '0', 'aria-label': 'Placed images' });
    this.list.addEventListener('keydown', (e) => this.onKey(e));
    this.info = h('dl.lk-info.files-info-list', { 'aria-label': 'Link info' });
    this.infoWrap = h('details.lk-details', { open: true }, h('summary', 'Link Info'), this.info);
    const btn = (name, label, fn) => iconButton(name, label, () => this.run(fn));
    this.footer = h(
      'div.lk-footer',
      (this.relinkBtn = btn('link', 'Relink...', (ed, ids) => relink(this.app, ed, ids))),
      (this.goBtn = btn('go-to', 'Go To Link', (ed, ids) => goToLink(ed, ids[0]))),
      (this.updateBtn = btn('refresh-cw-2', 'Update Link', async (ed, ids) => {
        const n = await updateLinks(this.app, ed, ids);
        this.app.notify(n ? `Updated ${n} link${n === 1 ? '' : 's'}.` : 'Only images placed from Puter can be updated.', { polite: Boolean(n) });
      })),
      (this.editBtn = btn('external-link', 'Edit Original', (ed, ids) => editOriginal(this.app, ed, ids[0]))),
      (this.embedBtn = btn('arrow-down-to-line', 'Embed Image', (ed, ids) => embedImages(ed, ids))),
    );
    this.empty = h('p.panel-empty', 'No placed images.');
    this.el.append(this.list, this.empty, this.infoWrap, this.footer);
  }

  /** Images the footer acts on: the panel's row, else the selected images. */
  targets() {
    const ed = this.app.editor;
    if (!ed) return [];
    const sel = ed.selectedNodes().filter((n) => n.type === 'image').map((n) => n.id);
    if (sel.length > 1) return sel;
    return this.selectedId && ed.doc.has(this.selectedId) ? [this.selectedId] : sel;
  }

  async run(fn) {
    const ed = this.app.editor;
    const ids = this.targets();
    if (!ed || !ids.length) return;
    try {
      await fn(ed, ids);
    } catch (err) {
      this.app.notify(err?.message || 'Something went wrong.', { error: true });
    }
  }

  onKey(e) {
    const ed = this.app.editor;
    if (!ed) return;
    const imgs = placedImages(ed.doc);
    const i = imgs.findIndex((n) => n.id === this.selectedId);
    const j = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: imgs.length - 1 }[e.key];
    if (e.key === 'Enter' && this.selectedId) {
      e.preventDefault();
      goToLink(ed, this.selectedId);
      return;
    }
    if (j === undefined || !imgs.length) return;
    e.preventDefault();
    e.stopPropagation();
    this.selectedId = imgs[Math.max(0, Math.min(imgs.length - 1, j))].id;
    this.key = null;
    this.update();
  }

  update() {
    const ed = this.app.editor;
    const imgs = ed ? placedImages(ed.doc) : [];
    // Follow the canvas: a single selected image becomes the panel's row.
    const selImg = ed?.selectedNodes().filter((n) => n.type === 'image') || [];
    if (selImg.length === 1 && this.lastSel !== selImg[0].id) this.selectedId = selImg[0].id;
    this.lastSel = selImg.length === 1 ? selImg[0].id : null;
    if (!imgs.some((n) => n.id === this.selectedId)) this.selectedId = imgs[0]?.id || null;
    const key = ed ? `${imgs.map((n) => `${n.id}:${n.asset}:${n.transform}:${Boolean(n.link)}`).join('|')}#${this.selectedId}` : '';
    this.empty.hidden = imgs.length > 0;
    this.list.hidden = !imgs.length;
    this.infoWrap.hidden = !imgs.length;
    const has = this.targets().length > 0;
    for (const b of [this.relinkBtn, this.goBtn, this.editBtn]) b.disabled = !has;
    this.updateBtn.disabled = !this.targets().some((id) => ed.doc.get(id)?.link);
    this.embedBtn.disabled = this.updateBtn.disabled;
    if (key === this.key && ed?.doc === this.keyDoc) return;
    this.key = key;
    this.keyDoc = ed?.doc;
    if (!ed) {
      this.list.replaceChildren();
      return;
    }
    const doc = ed.doc;
    this.list.replaceChildren(
      ...imgs.map((n) => {
        const info = imageInfo(doc, n);
        const a = doc.assets.get(n.asset);
        const row = h(
          'li.lk-row',
          { id: `lk-${n.id}`, role: 'option', 'aria-selected': String(n.id === this.selectedId) },
          a?.data ? h('img.lk-thumb', { src: a.data, alt: '' }) : h('span.lk-thumb.missing', icon('image', 14)),
          h('span.lk-name', info.name),
          h('span.lk-status', { 'data-tip': info.linked ? `Linked to ${info.location}` : 'Embedded', 'aria-label': info.linked ? 'Linked' : 'Embedded' }, icon(info.linked ? 'link' : 'images', 14)),
        );
        row.addEventListener('click', () => {
          this.selectedId = n.id;
          this.key = null;
          this.update();
        });
        row.addEventListener('dblclick', () => goToLink(ed, n.id));
        return row;
      }),
    );
    if (this.selectedId) this.list.setAttribute('aria-activedescendant', `lk-${this.selectedId}`);
    const node = doc.get(this.selectedId);
    if (!node) {
      this.info.replaceChildren();
      return;
    }
    const i = imageInfo(doc, node);
    const units = doc.root.units || 'pt';
    const toUnits = (pt) => {
      const f = { pt: 1, px: 1, in: 72, mm: 72 / 25.4, cm: 72 / 2.54, pc: 12 }[units] || 1;
      return `${fmt(pt / f, units === 'pt' || units === 'px' ? 1 : 2)} ${units}`;
    };
    const rows = [
      ['Name', i.name],
      ['Format', i.format],
      ['Pixels', `${fmt(i.pixels.w)} x ${fmt(i.pixels.h)} px`],
      ['Placed Size', `${toUnits(i.placed.w)} x ${toUnits(i.placed.h)}`],
      ['Resolution', `${fmt(i.ppi.x)}${Math.abs(i.ppi.x - i.ppi.y) > 0.5 ? ` x ${fmt(i.ppi.y)}` : ''} ppi`],
      ['Scale', `${fmt(i.scale.x, 1)}%${Math.abs(i.scale.x - i.scale.y) > 0.05 ? ` x ${fmt(i.scale.y, 1)}%` : ''}`],
      ['Rotation', `${fmt(i.rotation, 2)}°`],
      ['File Size', i.bytes ? formatBytes(i.bytes) : '-'],
      ['Status', i.missing ? 'Missing image data' : i.linked ? 'Linked and embedded' : 'Embedded'],
      ...(i.location ? [['Location', i.location]] : []),
    ];
    if (i.ppi.x < 150 && i.ppi.x > 0) rows.push(['Note', 'Below 150 ppi: may print soft.']);
    this.info.replaceChildren(...rows.flatMap(([k, v]) => [h('dt', k), h('dd', v)]));
  }
}
