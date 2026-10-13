/**
 * Snapshot undo history. Projects are small JSON documents (media lives in
 * files), so a structured clone per edit is cheap and keeps undo exact.
 */
export class History {
  constructor(limit = 200) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
  }

  /** Record the state before an edit. */
  push(snapshot, label) {
    this.undoStack.push({ snapshot, label });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  /** Returns { snapshot, label } to restore, given the current state to keep for redo. */
  undo(current) {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push({ snapshot: current, label: entry.label });
    return entry;
  }

  redo(current) {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push({ snapshot: current, label: entry.label });
    return entry;
  }

  get undoLabel() {
    return this.undoStack.at(-1)?.label || '';
  }

  get redoLabel() {
    return this.redoStack.at(-1)?.label || '';
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}
