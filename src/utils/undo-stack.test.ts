import { describe, expect, it } from "vitest";
import { UndoStack } from "./undo-stack";

describe("UndoStack", () => {
  it("pops in LIFO order", () => {
    const s = new UndoStack<number>();
    s.push(1);
    s.push(2);
    s.push(3);
    expect(s.pop()).toBe(3);
    expect(s.pop()).toBe(2);
    expect(s.pop()).toBe(1);
    expect(s.pop()).toBeUndefined();
  });

  it("reports size and isEmpty", () => {
    const s = new UndoStack<string>();
    expect(s.isEmpty).toBe(true);
    s.push("a");
    expect(s.isEmpty).toBe(false);
    expect(s.size).toBe(1);
  });

  it("drops the oldest snapshot when over the limit", () => {
    const s = new UndoStack<number>(3);
    for (const n of [1, 2, 3, 4]) s.push(n);
    expect(s.size).toBe(3);
    expect(s.pop()).toBe(4);
    expect(s.pop()).toBe(3);
    expect(s.pop()).toBe(2);
    expect(s.pop()).toBeUndefined();
  });

  it("clear empties the stack", () => {
    const s = new UndoStack<number>();
    s.push(1);
    s.push(2);
    s.clear();
    expect(s.isEmpty).toBe(true);
    expect(s.pop()).toBeUndefined();
  });
});
