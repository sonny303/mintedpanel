type ContextRevisionObserver = (revision: string | null) => void;

let observer: ContextRevisionObserver | null = null;
let currentRevision: string | null = null;
let revisionEpoch = 0;

/** The revision/epoch pair protects browser responses that outlive a context. */
export function getContextRevisionSnapshot(): { revision: string | null; epoch: number } {
  return { revision: currentRevision, epoch: revisionEpoch };
}

/** Mark protected work obsolete before a replacement context starts resolving. */
export function beginContextRefresh(): void {
  revisionEpoch += 1;
}

/** Install the revision of the context that was accepted by the store. */
export function setContextRevision(revision: string): void {
  if (currentRevision !== revision) {
    currentRevision = revision;
    revisionEpoch += 1;
  }
}

/** Clear the revision on identity/auth transitions. */
export function resetContextRevision(): void {
  currentRevision = null;
  revisionEpoch += 1;
}

export function registerContextRevisionObserver(next: ContextRevisionObserver): void {
  observer = next;
}

export function observeContextRevision(response: Response): void {
  const revision = response.headers.get("X-Minted-Context-Revision");
  if (revision === "unknown") {
    resetContextRevision();
    observer?.(null);
  } else if (revision) {
    setContextRevision(revision);
    observer?.(revision);
  } else if (response.status === 401 || response.status === 403) {
    resetContextRevision();
    observer?.(null);
  }
}

/**
 * Observe a protected response only when it still belongs to the request's
 * context. A response that crossed an auth/context epoch must not install its
 * revision or refresh the store with data from the previous principal.
 *
 * Mutations can opt out of rejection because their committed result (for
 * example, a one-time upload intent) must remain usable; the revision is still
 * observed when it can be trusted.
 */
export function observeContextRevisionForRequest(
  response: Response,
  before: { revision: string | null; epoch: number },
  options: { rejectStale?: boolean } = {},
): boolean {
  const rejectStale = options.rejectStale ?? true;
  const responseRevision = response.headers.get("X-Minted-Context-Revision");
  const after = getContextRevisionSnapshot();
  const stale =
    after.epoch !== before.epoch ||
    (responseRevision !== null && responseRevision !== before.revision);

  if (!stale) {
    observeContextRevision(response);
    return false;
  }

  // If no other refresh won the race, this response can still provide the
  // newer authoritative revision and trigger a replacement context. When an
  // auth/context transition already advanced the epoch, ignore the response
  // completely.
  if (after.epoch === before.epoch) observeContextRevision(response);
  return rejectStale;
}
