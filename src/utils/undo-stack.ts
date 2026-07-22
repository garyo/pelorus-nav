/**
 * Bounded LIFO of state snapshots for snapshot-style undo: callers push a
 * deep copy of their state before each mutation and pop to restore. When
 * full, the oldest snapshot is dropped.
 */

export class UndoStack<T> {
  private stack: T[] = [];
  private readonly limit: number;

  constructor(limit = 50) {
    this.limit = limit;
  }

  get size(): number {
    return this.stack.length;
  }

  get isEmpty(): boolean {
    return this.stack.length === 0;
  }

  push(snapshot: T): void {
    this.stack.push(snapshot);
    if (this.stack.length > this.limit) this.stack.shift();
  }

  pop(): T | undefined {
    return this.stack.pop();
  }

  clear(): void {
    this.stack.length = 0;
  }
}
