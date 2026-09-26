import type { FillRunLatch } from "@/lib/fillRunGuard";

export async function runExclusivePdfFill<T>(
  latch: FillRunLatch,
  run: () => Promise<T>,
  onStart?: () => void,
  onFinish?: () => void,
): Promise<{ started: false } | { started: true; value: T }> {
  if (!latch.tryStart()) return { started: false };
  onStart?.();
  try {
    return { started: true, value: await run() };
  } finally {
    latch.finish();
    onFinish?.();
  }
}

export async function prepareAndDownloadPdfIfCurrent<T>(input: {
  isCurrent: () => boolean;
  prepare: () => Promise<T>;
  download: (prepared: T) => void;
}): Promise<{ status: "stale" } | { status: "ready"; prepared: T }> {
  if (!input.isCurrent()) return { status: "stale" };
  const prepared = await input.prepare();
  if (!input.isCurrent()) return { status: "stale" };
  input.download(prepared);
  return { status: "ready", prepared };
}

export function commitAnalysisIfIdle(generationActive: boolean, commit: () => void): boolean {
  if (generationActive) return false;
  commit();
  return true;
}
