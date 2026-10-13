/**
 * Comments on a page live in the page's comments document ('<pageId>.c'),
 * which people who can comment (but not edit) are allowed to change:
 *
 *   threads: Y.Map<threadId, Y.Map{ block, quote, resolved, created, by, messages: Y.Array }>
 *   message: { id, by, text, at, edited }
 *
 * A thread with a block is anchored to that block (and the text that was
 * selected when it started); one without is about the whole page.
 */
import { Y, local } from './ydoc.js';
import { uid } from '../lib/ids.js';

const MAX_TEXT = 4000;

function threadsOf(doc) {
  return doc.getMap('threads');
}

function plainThread(id, m) {
  return {
    id,
    block: m.get('block') ?? null,
    quote: m.get('quote') || '',
    resolved: !!m.get('resolved'),
    created: m.get('created') || 0,
    by: m.get('by') || null,
    messages: (m.get('messages')?.toArray() || []).filter((x) => x && !x.deleted),
  };
}

export function listThreads(doc) {
  const out = [];
  for (const [id, m] of threadsOf(doc).entries()) if (m instanceof Y.Map) out.push(plainThread(id, m));
  return out.filter((t) => t.messages.length).sort((a, b) => a.created - b.created);
}

export function getThread(doc, id) {
  const m = threadsOf(doc).get(id);
  return m instanceof Y.Map ? plainThread(id, m) : null;
}

export function addThread(doc, { block = null, quote = '', text, by = null }) {
  const clean = String(text || '').trim().slice(0, MAX_TEXT);
  if (!clean) return null;
  const id = uid();
  local(doc, () => {
    const m = new Y.Map();
    const messages = new Y.Array();
    m.set('block', block);
    m.set('quote', String(quote || '').slice(0, 300));
    m.set('resolved', false);
    m.set('created', Date.now());
    m.set('by', by);
    m.set('messages', messages);
    messages.push([{ id: uid(), by, text: clean, at: Date.now() }]);
    threadsOf(doc).set(id, m);
  });
  return id;
}

export function reply(doc, threadId, text, by = null) {
  const m = threadsOf(doc).get(threadId);
  const clean = String(text || '').trim().slice(0, MAX_TEXT);
  if (!(m instanceof Y.Map) || !clean) return null;
  const id = uid();
  local(doc, () => {
    m.get('messages').push([{ id, by, text: clean, at: Date.now() }]);
    // Replying to a resolved thread opens it again.
    if (m.get('resolved')) m.set('resolved', false);
  });
  return id;
}

export function setResolved(doc, threadId, resolved) {
  const m = threadsOf(doc).get(threadId);
  if (!(m instanceof Y.Map)) return;
  local(doc, () => m.set('resolved', !!resolved));
}

function replaceMessage(doc, threadId, messageId, fn) {
  const m = threadsOf(doc).get(threadId);
  if (!(m instanceof Y.Map)) return false;
  const arr = m.get('messages');
  const i = arr.toArray().findIndex((x) => x?.id === messageId);
  if (i < 0) return false;
  local(doc, () => {
    const next = fn(arr.get(i));
    arr.delete(i, 1);
    arr.insert(i, [next]);
  });
  return true;
}

export function editMessage(doc, threadId, messageId, text) {
  const clean = String(text || '').trim().slice(0, MAX_TEXT);
  if (!clean) return false;
  return replaceMessage(doc, threadId, messageId, (msg) => ({ ...msg, text: clean, edited: Date.now() }));
}

/** Deletes a message; a thread with no messages left disappears. */
export function deleteMessage(doc, threadId, messageId) {
  const ok = replaceMessage(doc, threadId, messageId, (msg) => ({ id: msg.id, by: msg.by, at: msg.at, deleted: true }));
  const t = getThread(doc, threadId);
  if (ok && t && !t.messages.length) local(doc, () => threadsOf(doc).delete(threadId));
  return ok;
}

/** Open threads per block, for the markers in the margin. */
export function openByBlock(doc) {
  const counts = new Map();
  for (const t of listThreads(doc)) {
    if (t.resolved || !t.block) continue;
    counts.set(t.block, (counts.get(t.block) || 0) + 1);
  }
  return counts;
}

export function openCount(doc) {
  return listThreads(doc).filter((t) => !t.resolved).length;
}
