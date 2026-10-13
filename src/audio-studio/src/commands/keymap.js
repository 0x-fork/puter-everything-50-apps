// Default keyboard map: playhead navigation commands (in/out points, page
// left/right), the editor toggle, and the default keys of commands defined
// elsewhere, chosen to match the layout that audio editors commonly share so
// people switching tools keep their habits. Users remap any of them in
// Edit > Keyboard Shortcuts; their choices take precedence.

const doc = (app) => app.active;
const hasSel = (app) => Boolean(app.active?.hasSelection);

function seek(app, frame) {
  const d = doc(app);
  frame = Math.max(0, Math.min(d.length, Math.round(frame)));
  const view = app.currentView?.();
  if (view?.seek) view.seek(frame);
  else d.setCursor(frame);
  const v = d.view;
  if (frame < v.start || frame > v.end) d.setView(frame - (v.end - v.start) / 2, frame + (v.end - v.start) / 2);
}

/** Default keys by command id: [primary, ...alternatives]. */
export const DEFAULT_KEYS = {
  'transport.toStart': ['Home', 'Mod+ArrowLeft'],
  'transport.toEnd': ['End', 'Mod+ArrowRight'],
  'transport.previous': ['Alt+ArrowLeft'],
  'transport.next': ['Alt+ArrowRight'],
  'transport.pause': ['Mod+Shift+Space'],
  'marker.previous': ['Mod+Alt+ArrowLeft'],
  'marker.next': ['Mod+Alt+ArrowRight'],
  'marker.add': ['M', 'F8'],
  'marker.addCart': ['C'],
  'marker.rename': ['/'],
  'view.zoomResetTime': ['\\'],
  'view.zoomFull': ['Mod+\\'],
  'view.zoomSelection': ['Shift+S', 'Shift+\\'],
  'view.zoomInPoint': ['Alt+Home'],
  'view.zoomOutPoint': ['Alt+End'],
  'view.zoomInTrack': ['Shift+/'],
  'view.autoScroll': ['A'],
  'view.spectral': ['Shift+D', 'F9'],
  'transport.meterInput': ['F10'],
  'edit.convertSampleType': ['Shift+T', 'F11'],
  'edit.repeat': ['Mod+R', 'F3'],
  'edit.clearTimeSelection': ['G'],
  'edit.selectNextClip': ['.'],
};

export function installKeymap(app) {
  const C = app.commands;
  C.register([
    { id: 'transport.toInPoint', label: 'Move Playhead to In Point', shortcut: 'Q', enabled: hasSel, run: () => seek(app, doc(app).selection.start) },
    { id: 'transport.toOutPoint', label: 'Move Playhead to Out Point', shortcut: 'W', enabled: hasSel, run: () => seek(app, doc(app).selection.end) },
    {
      id: 'transport.pageLeft',
      label: 'Move Playhead Page Left',
      shortcut: 'PageUp',
      enabled: (a) => Boolean(a.active),
      run: () => {
        const d = doc(app);
        const span = d.view.end - d.view.start;
        d.setView(d.view.start - span, d.view.end - span);
        seek(app, app.playhead - span);
      },
    },
    {
      id: 'transport.pageRight',
      label: 'Move Playhead Page Right',
      shortcut: 'PageDown',
      enabled: (a) => Boolean(a.active),
      run: () => {
        const d = doc(app);
        const span = d.view.end - d.view.start;
        d.setView(d.view.start + span, d.view.end + span);
        seek(app, app.playhead + span);
      },
    },
    {
      id: 'edit.setInPoint',
      label: 'Set In Point to Playhead',
      shortcut: 'I',
      enabled: (a) => Boolean(a.active?.setSelection),
      run: () => {
        const d = doc(app);
        const at = Math.round(app.playhead);
        d.setSelection(at, d.hasSelection && d.selection.end > at ? d.selection.end : d.length);
      },
    },
    {
      id: 'edit.setOutPoint',
      label: 'Set Out Point to Playhead',
      shortcut: 'O',
      enabled: (a) => Boolean(a.active?.setSelection),
      run: () => {
        const d = doc(app);
        const at = Math.round(app.playhead);
        d.setSelection(d.hasSelection && d.selection.start < at ? d.selection.start : 0, at);
      },
    },
    {
      id: 'view.toggleEditor',
      label: 'Toggle Waveform and Multitrack Editors',
      shortcut: 'F12',
      altShortcuts: ['1'],
      run: () => C.run(app.active?.kind === 'session' ? 'view.waveform' : 'view.multitrack'),
    },
  ]);
  // Re-register existing commands with their default keys (skipping ones another feature left out).
  for (const [id, keys] of Object.entries(DEFAULT_KEYS)) {
    const def = C.commands.get(id);
    if (!def) continue;
    C.register({ ...def, shortcut: keys[0], altShortcuts: keys.slice(1) });
  }
  C.reloadShortcuts();
}
