import { test as base, expect } from "@playwright/test";

export type { BrowserContext, Page, Route } from "@playwright/test";

type Session = {
  access_token?: unknown;
  user?: {
    id?: unknown;
    email?: unknown;
  };
};

type MembershipRow = {
  org_id?: unknown;
  role?: unknown;
  organizations?: unknown;
};

type StaffOrg = {
  orgId: string;
  orgName: string;
  role: string;
  reportStaff: boolean;
  clientManage: boolean;
};

type LegacyContext = {
  actorUserId: string;
  email: string | null;
  audience: "staff" | null;
  selectedOrgId: string | null;
  staffOrgs: StaffOrg[];
  clientOrgs: [];
  globalTraining: true;
  restrictedExternal: false;
  contextRevision: string;
};

function installLegacyAccessContext(authStorageKey: string): void {
  const nativeFetch = window.fetch.bind(window);
  const membershipCache = new Map<string, { accessToken: string; rows: unknown[] }>();

  function response(body: unknown, status = 200, contextRevision?: string): Response {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (contextRevision) headers["X-Minted-Context-Revision"] = contextRevision;
    return new Response(JSON.stringify(body), { status, headers });
  }

  function errorResponse(status: number, message: string): Response {
    return response({ data: null, error: message }, status);
  }

  function readSession(): Session | null {
    const raw = window.localStorage.getItem(authStorageKey);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      return parsed as Session;
    } catch {
      return null;
    }
  }

  function sessionIdentity(
    session: Session | null,
  ): { actorUserId: string; accessToken: string } | null {
    const actorUserId = session?.user?.id;
    const accessToken = session?.access_token;
    if (
      typeof actorUserId !== "string" ||
      actorUserId.length === 0 ||
      typeof accessToken !== "string" ||
      accessToken.length === 0
    ) {
      return null;
    }
    return { actorUserId, accessToken };
  }

  function requestHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    if (init?.headers) {
      new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    }
    return headers;
  }

  function orgName(value: unknown): string | null {
    if (Array.isArray(value)) return orgName(value[0]);
    if (!value || typeof value !== "object") return null;
    const name = (value as { name?: unknown }).name;
    return typeof name === "string" && name.length > 0 ? name : null;
  }

  function revisionFor(actorUserId: string, email: string | null, orgs: StaffOrg[]): string {
    const authority = [...orgs].sort((left, right) => {
      const leftKey = `${left.orgId}:${left.role}`;
      const rightKey = `${right.orgId}:${right.role}`;
      return leftKey.localeCompare(rightKey);
    });
    const source = JSON.stringify([
      actorUserId,
      email ?? "",
      authority.map((org) => [org.orgId, org.orgName, org.role, org.reportStaff, org.clientManage]),
    ]);
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `legacy-e612-${(hash >>> 0).toString(16).padStart(8, "0")}`;
  }

  function buildContext(): { context: LegacyContext } | { status: number; message: string } {
    const session = readSession();
    const identity = sessionIdentity(session);
    if (!identity) {
      return { status: 401, message: "Verified session required" };
    }
    const cached = membershipCache.get(identity.actorUserId);
    if (!cached || cached.accessToken !== identity.accessToken) {
      return {
        status: 500,
        message: "Legacy E2E access fixture did not receive memberships data",
      };
    }

    const { actorUserId } = identity;
    const email = typeof session.user?.email === "string" ? session.user.email : null;
    const staffOrgs: StaffOrg[] = [];
    for (const rawRow of cached.rows) {
      if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) {
        return { status: 500, message: "Legacy E2E memberships fixture returned an invalid row" };
      }
      const row = rawRow as MembershipRow;
      if (typeof row.org_id !== "string" || row.org_id.length === 0) {
        return { status: 500, message: "Legacy E2E memberships fixture is missing org_id" };
      }
      if (typeof row.role !== "string" || row.role.length === 0) {
        return { status: 500, message: "Legacy E2E memberships fixture is missing role" };
      }
      const name = orgName(row.organizations);
      if (!name) {
        return {
          status: 500,
          message: `Legacy E2E memberships fixture is missing organization name for ${row.org_id}`,
        };
      }
      staffOrgs.push({
        orgId: row.org_id,
        orgName: name,
        role: row.role,
        reportStaff: false,
        clientManage: false,
      });
    }

    return {
      context: {
        actorUserId,
        email,
        audience: staffOrgs.length > 0 ? "staff" : null,
        selectedOrgId: null,
        staffOrgs,
        clientOrgs: [],
        globalTraining: true,
        restrictedExternal: false,
        contextRevision: revisionFor(actorUserId, email, staffOrgs),
      },
    };
  }

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(rawUrl, window.location.href);

    // Observe the existing per-spec memberships response. This keeps the
    // access fixture tied to the same actor, orgs, names, and roles as the
    // legacy shell fixture instead of inventing a parallel authorization set.
    if (url.pathname.endsWith("/rest/v1/memberships")) {
      const requestIdentity = sessionIdentity(readSession());
      const requestedUserId = url.searchParams.get("user_id");
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      const result = await nativeFetch(input, init);
      const isSelfMembershipRead =
        method === "GET" &&
        result.ok &&
        requestIdentity !== null &&
        requestedUserId === `eq.${requestIdentity.actorUserId}`;
      if (!isSelfMembershipRead) return result;
      const copy = result.clone();
      try {
        const body: unknown = await copy.json();
        if (!Array.isArray(body)) {
          throw new Error("memberships response was not an array");
        }
        const currentIdentity = sessionIdentity(readSession());
        if (
          isSelfMembershipRead &&
          currentIdentity?.actorUserId === requestIdentity.actorUserId &&
          currentIdentity.accessToken === requestIdentity.accessToken
        ) {
          membershipCache.set(requestIdentity.actorUserId, {
            accessToken: requestIdentity.accessToken,
            rows: body,
          });
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : "unknown response error";
        throw new Error(`Legacy E2E access fixture could not read memberships: ${detail}`);
      }
      return result;
    }

    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const isSameOrigin = url.origin === window.location.origin;
    const isDiscovery =
      isSameOrigin && url.pathname === "/api/me/access-context" && method === "GET";
    const isSelection =
      isSameOrigin && url.pathname === "/api/me/access-context/select" && method === "POST";
    if (!isDiscovery && !isSelection) return nativeFetch(input, init);

    const session = readSession();
    const identity = sessionIdentity(session);
    const authorization = requestHeaders(input, init).get("authorization");
    if (!identity || authorization !== `Bearer ${identity.accessToken}`) {
      return errorResponse(401, "Verified session required");
    }

    const built = buildContext();
    if ("status" in built) return errorResponse(built.status, built.message);
    const { context } = built;
    if (isDiscovery) return response({ data: context, error: null }, 200, context.contextRevision);

    let body: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      body = null;
    }
    const audience = body?.audience;
    const orgId = body?.orgId;
    const expectedRevision = body?.contextRevision;
    if (audience !== "staff" || typeof orgId !== "string" || typeof expectedRevision !== "string") {
      return errorResponse(422, "audience, orgId, and contextRevision are required");
    }
    if (expectedRevision !== context.contextRevision) {
      return errorResponse(409, "Access context changed; refresh before selecting a new context");
    }
    if (!context.staffOrgs.some((org) => org.orgId === orgId)) {
      return errorResponse(403, "This access context is not authorized");
    }
    return response(
      { data: { ...context, audience: "staff", selectedOrgId: orgId }, error: null },
      200,
      context.contextRevision,
    );
  };
}

export const test = base.extend({
  context: async ({ context }, runTest) => {
    await context.addInitScript(installLegacyAccessContext, "sb-example-auth-token");
    await runTest(context);
  },
});

export { expect };
