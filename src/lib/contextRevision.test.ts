import { beforeEach, describe, expect, it, vi } from "vitest";

import { observeContextRevision, registerContextRevisionObserver } from "./contextRevision";

function response(status: number, revision?: string): Response {
  return new Response(null, {
    status,
    headers: revision ? { "X-Minted-Context-Revision": revision } : undefined,
  });
}

describe("E6.12 context revision observer", () => {
  beforeEach(() => {
    registerContextRevisionObserver(() => undefined);
  });

  it("publishes the authoritative revision header from protected responses", () => {
    const revisions: Array<string | null> = [];
    registerContextRevisionObserver((revision) => revisions.push(revision));

    observeContextRevision(response(200, "rev-17"));
    observeContextRevision(response(204, "rev-18"));

    expect(revisions).toEqual(["rev-17", "rev-18"]);
  });

  it.each([401, 403])("forces a refresh when a protected response is %s", (status) => {
    const observer = vi.fn<(revision: string | null) => void>();
    registerContextRevisionObserver(observer);

    observeContextRevision(response(status));

    expect(observer).toHaveBeenCalledOnce();
    expect(observer).toHaveBeenCalledWith(null);
  });

  it("does not invalidate context for an unrelated response without a revision", () => {
    const observer = vi.fn<(revision: string | null) => void>();
    registerContextRevisionObserver(observer);

    observeContextRevision(response(200));
    observeContextRevision(response(409));

    expect(observer).not.toHaveBeenCalled();
  });

  it("replaces the observer so an unmounted lifecycle cannot receive later events", () => {
    const oldObserver = vi.fn<(revision: string | null) => void>();
    const currentObserver = vi.fn<(revision: string | null) => void>();
    registerContextRevisionObserver(oldObserver);
    registerContextRevisionObserver(currentObserver);

    observeContextRevision(response(200, "rev-current"));

    expect(oldObserver).not.toHaveBeenCalled();
    expect(currentObserver).toHaveBeenCalledWith("rev-current");
  });
});
