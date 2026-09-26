/** Invalidates asynchronous fill work whenever its owner changes context or unmounts. */
export interface FillRunGuard {
  activate(): void;
  capture(): number;
  isCurrent(token: number): boolean;
  setContext(key: string): void;
  invalidate(): void;
}

export interface FillRunLatch {
  tryStart(): boolean;
  finish(): void;
}

/** Synchronously claim a fill before its first await so rapid clicks cannot
 * start overlapping refresh/generation/recording runs. */
export function createFillRunLatch(): FillRunLatch {
  let running = false;
  return {
    tryStart() {
      if (running) return false;
      running = true;
      return true;
    },
    finish() {
      running = false;
    },
  };
}

export interface PdfActorContext {
  orgId: string | null;
  userId: string | null;
  authGeneration: number;
  contextEpoch: number;
}

export function isSamePdfActorContext(left: PdfActorContext, right: PdfActorContext): boolean {
  return (
    left.orgId === right.orgId &&
    left.userId === right.userId &&
    left.authGeneration === right.authGeneration &&
    left.contextEpoch === right.contextEpoch
  );
}

export function isPdfFillContextCurrent(input: {
  runIsCurrent: boolean;
  expectedSourceGeneration: number;
  currentSourceGeneration: number;
  expectedActor: PdfActorContext;
  currentActor: PdfActorContext;
}): boolean {
  return (
    input.runIsCurrent &&
    input.expectedSourceGeneration === input.currentSourceGeneration &&
    isSamePdfActorContext(input.expectedActor, input.currentActor)
  );
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
