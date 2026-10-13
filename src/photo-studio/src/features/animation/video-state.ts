// Video timeline state that menus, the panel and hooks read at any time
// (kept apart from the implementation, which loads on first use): the
// document's timeline, the selected video layer, per-document Timeline view
// settings (zoom, selected keyframes, expanded tracks) and playback.
import type { Editor } from '../../editor';
import type { DocumentSession } from '../../app/session';
import type { Layer } from '../../model/document';
import type { VideoLayerData } from '../../model/video-layer';
import type { KeyProperty } from '../../model/video-timeline';

export type VideoLayer = Layer & { video: VideoLayerData };
export const timelineOf = (e: Editor) => (e.hasDocument ? e.doc.timeline : undefined);
export const hasTimeline = (e: Editor) => !!timelineOf(e);
export const isVideoLayer = (l: Layer | undefined): l is VideoLayer => !!l?.video && l.kind === 'pixel';
/** The selected video layer (one layer selected). */
export const videoLayerOf = (e: Editor): VideoLayer | undefined => {
  if (!hasTimeline(e) || e.selectedIds.size !== 1) return undefined;
  const l = e.layer;
  return isVideoLayer(l) ? l : undefined;
};
export const hasVideoLayers = (e: Editor) => e.hasDocument && hasVideo(e.doc.layers);
const hasVideo = (layers: Layer[]): boolean => layers.some((l) => isVideoLayer(l) || hasVideo(l.children));

/** A selected keyframe: layer, property and content frame. */
export type KeyRef = { id: string; prop: KeyProperty; t: number };
export type VideoView = {
  // Pixels per timeline frame.
  zoom: number;
  keys: KeyRef[];
  // Layers whose keyframe lanes are open.
  expanded: Set<string>;
  // Playback loops over the work area.
  loop: boolean;
};
const views = new WeakMap<DocumentSession, VideoView>();
export function videoView(e: Editor): VideoView {
  let v = views.get(e.session);
  if (!v) views.set(e.session, (v = { zoom: 0, keys: [], expanded: new Set(), loop: true }));
  return v;
}

// Playback (set by the playback module while a timeline plays).
export const videoPlayback: { session?: DocumentSession; frame: number } = { frame: 0 };
export const isVideoPlaying = (e?: Editor) => !!videoPlayback.session && (!e || videoPlayback.session === e.session);
