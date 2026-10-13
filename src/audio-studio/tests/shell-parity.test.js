// App shell: built-in workspaces, toolbar workspace tabs and the migration of
// layouts saved against older built-in arrangements.
import { describe, it, expect } from 'vitest';
import { WORKSPACES, DEFAULT_TABS, LAYOUT_VERSION } from '../src/ui/workspaces.js';

const groups = (node, out = []) => {
  if (node.t === 'group') out.push(node);
  else for (const c of node.c) groups(c, out);
  return out;
};
const groupWith = (tree, id) => groups(tree).find((g) => g.tabs.includes(id));

async function makeApp(stored) {
  HTMLCanvasElement.prototype.getContext = () => null;
  globalThis.ResizeObserver ??= class {
    observe() {}
    disconnect() {}
  };
  localStorage.clear();
  if (stored) localStorage.setItem('audio-studio:prefs', JSON.stringify(stored));
  const { App } = await import('../src/app.js');
  const { installCore } = await import('../src/features/core.js');
  const app = new App();
  installCore(app);
  app.syncGraph = () => {};
  return app;
}

describe('Default workspace', () => {
  const tree = WORKSPACES.Default();

  it('groups the panels like a desktop audio editor', () => {
    expect(groupWith(tree, 'files').tabs).toEqual(['files', 'favorites']);
    expect(groupWith(tree, 'media').tabs).toEqual(['media', 'effects', 'markers', 'properties']);
    expect(groupWith(tree, 'history').tabs).toEqual(['history', 'video']);
    expect(groupWith(tree, 'editor').tabs).toEqual(['editor', 'mixer']);
    expect(groupWith(tree, 'assistant').tabs).toEqual(['assistant']);
    // Levels has a frame of its own, showing on first launch.
    expect(groupWith(tree, 'levels')).toMatchObject({ tabs: ['levels'], a: 'levels' });
    expect(groupWith(tree, 'selection').tabs).toEqual(['selection']);
    expect(groupWith(tree, 'phase')).toBeUndefined();
  });

  it('puts the meters under the editor and the browsers in the left column', () => {
    expect(tree.t).toBe('row');
    const [left, right] = tree.c;
    expect(left.t).toBe('col');
    expect(left.c.map((g) => g.a)).toEqual(['files', 'media', 'history']);
    const [top, bottom] = right.c;
    expect(top.c.map((g) => g.a)).toEqual(['editor', 'assistant']);
    expect(bottom.c.map((g) => g.a)).toEqual(['levels', 'selection']);
    // The editor row takes most of the height.
    expect(right.s[0] / right.s[1]).toBeGreaterThan(5);
  });
});

describe('workspace tabs and saved layouts', () => {
  it('shows Default, Edit Audio to Video and Radio Production as toolbar tabs by default', async () => {
    const app = await makeApp();
    const { tabNames } = await import('../src/ui/workspace-manager.js');
    expect(DEFAULT_TABS.every((n) => WORKSPACES[n])).toBe(true);
    expect(tabNames(app)).toEqual(DEFAULT_TABS);
    const labels = app.workspaceMenuItems().filter((i) => i.type === 'cmd').map((i) => i.label);
    expect(labels.slice(0, 11)).toEqual(Object.keys(WORKSPACES));
  });

  it('drops layouts arranged on top of older built-in workspaces', async () => {
    const custom = { t: 'group', tabs: ['editor'], a: 'editor' };
    const app = await makeApp({
      workspace: 'Minimal Edit',
      layouts: { Default: { t: 'group', tabs: ['phase'], a: 'phase' }, Classic: custom, Mine: custom },
      savedLayouts: { Classic: custom },
      customWorkspaces: { Mine: custom },
    });
    expect(app.prefs.get('layoutVersion')).toBe(LAYOUT_VERSION);
    expect(Object.keys(app.prefs.get('layouts')).sort()).toEqual(['Classic', 'Mine']);
    // A workspace that no longer exists falls back to Default.
    expect(app.prefs.get('workspace')).toBe('Default');
    app.layoutMode = 'desktop';
    expect(groupWith(app.currentLayout(), 'levels').a).toBe('levels');
  });

  it('keeps arrangements made against the current version', async () => {
    const mine = { t: 'group', tabs: ['editor', 'levels'], a: 'levels' };
    const app = await makeApp({ layoutVersion: LAYOUT_VERSION, layouts: { Default: mine } });
    expect(app.prefs.get('layouts').Default).toEqual(mine);
  });
});

describe('status bar', async () => {
  const { statusParts } = await import('../src/ui/status-fields.js');
  const { setVideoOfDoc } = await import('../src/video/media.js');
  const { Prefs } = await import('../src/lib/prefs.js');
  const app = { prefs: new Prefs({ getItem: () => null, setItem: () => {} }), formatTime: (f, rate) => `${(f / rate).toFixed(3)}`, recording: false };
  const doc = { kind: 'audio', sampleRate: 48000, channelCount: 2, length: 48000 * 12, info: { bitDepth: 16 }, dirty: false, source: { type: 'local' } };

  it('sizes uncompressed audio at the file bit depth and shows free space', () => {
    expect(statusParts(app, doc, { cursor: null, freeBytes: 2 * 1024 ** 3 })).toEqual(['48000 Hz • 16-bit • Stereo', '2.20 MB', '12.000', '2.00 GB free']);
  });

  it('shows only the free space while no file is open', () => {
    expect(statusParts(app, null, { cursor: null, freeBytes: 1024 ** 3 })).toEqual(['1.00 GB free']);
    expect(statusParts(app, null, { cursor: null, freeBytes: null })).toEqual([]);
  });

  it('shows the frame rate of the video a file came with', () => {
    const withVideo = { ...doc };
    setVideoOfDoc(withVideo, { fps: 29.97 });
    expect(statusParts(app, withVideo, { cursor: null, freeBytes: null })[0]).toBe('29.97 fps');
    app.prefs.set('statusFields', { frameRate: false });
    expect(statusParts(app, withVideo, { cursor: null, freeBytes: null })).not.toContain('29.97 fps');
  });
});
