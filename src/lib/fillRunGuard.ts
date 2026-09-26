/** Invalidates asynchronous fill work whenever its owner changes context or unmounts. */
export interface FillRunGuard {
  activate(): void;
  capture(): number;
  isCurrent(token: number): boolean;
  setContext(key: string): void;
  invalidate(): void;
}

export function createFillRunGuard(initialContext: string): FillRunGuard {
  let context = initialContext;
  let generation = 0;
  let active = true;

  return {
    activate() {
      generation += 1;
      active = true;
    },
    capture() {
      return generation;
    },
    isCurrent(token) {
      return active && token === generation;
    },
    setContext(nextContext) {
      if (nextContext === context) return;
      context = nextContext;
      generation += 1;
    },
    invalidate() {
      active = false;
      generation += 1;
    },
  };
}
