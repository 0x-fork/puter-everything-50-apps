// Built-in workspace layouts (see dock.js for the tree format). The app picks
// the phone or tablet layout automatically on narrow screens; on desktop the
// user chooses a workspace and may save their own.

const g = (tabs, a = tabs[0]) => ({ t: 'group', tabs, a });
const row = (c, s) => ({ t: 'row', c, s: s || c.map(() => 1) });
const col = (c, s) => ({ t: 'col', c, s: s || c.map(() => 1) });

export const WORKSPACES = {
  Default: () =>
    row(
      [
        col([g(['files', 'favorites', 'tracks']), g(['media', 'effects', 'markers']), g(['history', 'playlist'])], [1, 1.6, 0.7]),
        col(
          [
            row([g(['editor', 'mixer']), g(['assistant', 'properties', 'trackPanner'])], [3.1, 1.2]),
            row([g(['levels']), g(['selection'])], [3.1, 1.2]),
          ],
          [5.2, 1],
        ),
      ],
      [1, 4.3],
    ),
  Classic: () =>
    row(
      [
        col([g(['files', 'effects', 'favorites']), g(['history', 'markers', 'playlist'])], [1.3, 1]),
        col([g(['editor', 'mixer']), row([g(['levels']), g(['selection'])], [3, 1])], [5, 1]),
      ],
      [1, 4],
    ),
  'Edit Audio': () =>
    row(
      [
        col([g(['editor', 'mixer']), g(['levels'])], [6, 1]),
        col([g(['effects', 'files']), g(['markers', 'history', 'playlist']), g(['selection', 'time'])], [2, 1.4, 0.6]),
      ],
      [4, 1.1],
    ),
  // The picture above the full-width editor, media and details beside it.
  'Edit Audio to Video': () =>
    col(
      [
        row([g(['files', 'media', 'markers']), g(['video']), g(['properties', 'history', 'effects'])], [1.1, 2.4, 1.1]),
        g(['editor', 'mixer']),
        row([g(['levels']), g(['selection', 'time'])], [3.4, 1]),
      ],
      [2.3, 2.8, 0.6],
    ),
  'Mastering and Analysis': () =>
    row(
      [
        col([g(['effects', 'files']), g(['amplitude', 'history', 'events'])], [1.6, 1]),
        col([g(['editor', 'mixer']), row([g(['frequency']), g(['phase', 'loudness'])], [1.6, 1])], [2.4, 1]),
        col([g(['levels'])]),
      ],
      [1, 3.4, 0.35],
    ),
  'Radio Production': () =>
    row(
      [
        col([g(['files', 'media', 'tracks']), g(['favorites', 'markers', 'playlist'])], [1, 1]),
        col([g(['editor', 'mixer']), row([g(['levels']), g(['selection'])], [3, 1])], [5, 1]),
        col([g(['assistant', 'properties', 'effects']), g(['trackPanner', 'time'])], [2.6, 1]),
      ],
      [1, 3.6, 1.1],
    ),
  'Minimal Edit': () => col([g(['editor', 'mixer']), g(['levels'])], [8, 1]),
  'Advanced Mixing': () =>
    row(
      [
        col([g(['tracks', 'files']), g(['trackPanner', 'properties'])], [1.1, 1]),
        col([g(['editor', 'mixer'], 'mixer'), row([g(['levels']), g(['time']), g(['transport'])], [3, 1.1, 1.2])], [5, 1]),
        col([g(['effects', 'assistant']), g(['history', 'events'])], [1.6, 1]),
      ],
      [1, 3.6, 1.1],
    ),
  Loudness: () =>
    row(
      [
        col([g(['files', 'effects', 'favorites']), g(['amplitude', 'history'])], [1.4, 1]),
        col([g(['editor', 'mixer']), row([g(['loudness']), g(['phase', 'frequency']), col([g(['time']), g(['selection'])])], [1.6, 1.2, 1])], [2.2, 1]),
        col([g(['levels'])]),
      ],
      [1, 3.4, 0.4],
    ),
  Restoration: () =>
    row(
      [
        col([g(['diagnostics', 'effects']), g(['history', 'markers'])], [1.6, 1]),
        col([g(['editor', 'mixer']), row([g(['levels']), g(['zoom']), g(['selection'])], [2.4, 1.3, 1])], [5, 1]),
        col([g(['frequency', 'amplitude']), g(['properties', 'events'])], [1.3, 1]),
      ],
      [1.1, 3.6, 1.2],
    ),
  'Simple Editing': () =>
    row(
      [
        col([g(['files', 'markers']), g(['history'])], [1.6, 1]),
        col([g(['editor', 'mixer']), row([g(['transport']), g(['time']), g(['levels'])], [1, 1, 2])], [5, 1]),
      ],
      [1, 4],
    ),
};

/** Layout for tablets in portrait or narrow windows (about 700 to 1100 px). */
export const TABLET = () =>
  row(
    [
      col([g(['editor', 'mixer']), g(['levels'])], [6, 1]),
      col([g(['files', 'effects', 'favorites', 'media', 'tracks']), g(['properties', 'assistant', 'markers', 'history', 'selection', 'trackPanner'])], [1, 1]),
    ],
    [3, 1.15],
  );

/** Layout for phones: the editor on top, every other panel as tabs below. */
export const PHONE = () =>
  col(
    [
      g(['editor', 'mixer']),
      g(['levels', 'files', 'effects', 'markers', 'history', 'properties', 'selection', 'favorites', 'assistant', 'media', 'tracks', 'trackPanner']),
    ],
    [3, 1.5],
  );

export const DEFAULT_WORKSPACE = 'Default';
