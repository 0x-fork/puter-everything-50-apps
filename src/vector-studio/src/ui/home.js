/**
 * Home screen shown when no document is open (and from the Home button):
 * new-file presets, open, and recent files. The file module fills the
 * recent list through `app.recentFiles()` when storage is available.
 */
import { h } from '../lib/dom.js';
import { icon } from './icons.js';

export const QUICK_PRESETS = [
  { name: 'Letter', width: 612, height: 792, units: 'pt', note: '8.5 x 11 in' },
  { name: 'A4', width: 595.28, height: 841.89, units: 'mm', note: '210 x 297 mm' },
  { name: 'Postcard', width: 288, height: 560, units: 'pt', note: '288 x 560 pt' },
  { name: 'Web', width: 1920, height: 1080, units: 'px', note: '1920 x 1080 px' },
  { name: 'Mobile', width: 390, height: 844, units: 'px', note: '390 x 844 px' },
  { name: 'Square', width: 1080, height: 1080, units: 'px', note: '1080 x 1080 px' },
  { name: 'Icon', width: 512, height: 512, units: 'px', note: '512 x 512 px' },
  { name: 'Poster', width: 1296, height: 1728, units: 'in', note: '18 x 24 in' },
];

export function installHome(app) {
  app.renderHome = (host) => renderHome(app, host);
}

function presetThumb(p) {
  const max = 64;
  const s = max / Math.max(p.width, p.height);
  return h('span.preset-thumb', { 'aria-hidden': 'true' }, h('span.preset-page', { style: { width: `${Math.max(8, p.width * s)}px`, height: `${Math.max(8, p.height * s)}px` } }));
}

async function renderHome(app, host) {
  const recentList = h('div.recent-list', { 'aria-label': 'Recent files' }, h('p.muted', 'Loading recent files...'));
  const presets = h(
    'div.preset-row',
    QUICK_PRESETS.map((p) =>
      h(
        'button.preset-card',
        {
          type: 'button',
          onclick: () => app.newDocument({ name: undefined, width: p.width, height: p.height, units: p.units }),
        },
        presetThumb(p),
        // The name comes from the visible text (voice control users say what they see).
        h('span.preset-name', p.name),
        ' ',
        h('span.preset-note', p.note),
      ),
    ),
  );
  const side = h(
    'nav.home-side',
    { 'aria-label': 'Home' },
    h('button.btn.primary.block', { type: 'button', onclick: () => app.commands.run('file.new') }, icon('plus', 16), 'New file'),
    app.commands.get('file.open') ? h('button.btn.block', { type: 'button', onclick: () => app.commands.run('file.open') }, icon('folder-open', 16), 'Open') : null,
    app.editors.length ? h('button.btn.block.ghost', { type: 'button', onclick: () => app.activate(app.editor || app.editors[0]) }, icon('chevron-left', 16), 'Back to document') : null,
  );
  const main = h(
    'div.home-main',
    h('h1.home-title', app.user ? `Welcome back, ${app.user.username}` : 'Welcome to Vector Studio'),
    h('p.home-sub', 'Draw logos, icons, illustrations and layouts with precise vector tools.'),
    h('h2.home-h2', 'Start a new file fast'),
    presets,
    h('h2.home-h2', 'Recent'),
    recentList,
  );
  host.replaceChildren(h('div.home', side, main, h('footer.home-footer', h('a', { href: 'https://developer.puter.com', target: '_blank', rel: 'noopener' }, 'Powered by Puter'))));
  try {
    const items = (await app.recentFiles?.()) || [];
    // Only a populated list is a list: a lone message is not a list item.
    if (items.length) recentList.setAttribute('role', 'list');
    if (!items.length) {
      recentList.replaceChildren(h('p.muted', 'Files you open or save appear here.'));
      return;
    }
    recentList.replaceChildren(
      ...items.map((it) => {
        const open = h(
          'button.recent-item',
          { type: 'button', title: it.path || it.name, onclick: () => app.openRecent?.(it) },
          it.thumb ? h('img.recent-thumb', { src: it.thumb, alt: '' }) : h('span.recent-thumb', icon('file-image', 24)),
          h('span.recent-name', it.name),
          h('span.recent-meta', it.when || ''),
        );
        // A listitem wrapper keeps the button's own role (a button cannot also be a listitem).
        const cell = h('div.recent-cell', { role: 'listitem' }, open);
        if (!app.removeRecent) return cell;
        // The file module can drop entries from the list.
        cell.append(
          h('button.icon-btn.recent-remove', { type: 'button', 'aria-label': `Remove ${it.name} from recent`, 'data-tip': 'Remove from recent', onclick: async () => {
            await app.removeRecent(it);
            cell.remove();
            if (!recentList.children.length) {
              recentList.removeAttribute('role');
              recentList.replaceChildren(h('p.muted', 'Files you open or save appear here.'));
            }
          } }, icon('x', 12)),
        );
        return cell;
      }),
    );
  } catch {
    recentList.removeAttribute('role');
    recentList.replaceChildren(h('p.muted', 'Recent files are unavailable right now.'));
  }
}
