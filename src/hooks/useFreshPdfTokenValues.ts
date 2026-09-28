import { useCallback } from "react";
import { useAuthStore } from "@/lib/auth-store";
import { resolveOrgContactTokens } from "@/lib/orgContactTokens";
import { resolveUserTokenValues } from "@/lib/userTokenValues";
import { isSamePdfActorContext, type PdfActorContext } from "@/lib/fillRunGuard";
import { listOrgParties } from "@/services/parties";
import { getMyProfile } from "@/services/userProfile";
import type { OrgParty, PartyRoleKey } from "@/types";

const FILL_TIME_TOKEN_FAMILIES = [
  "user.",
  "billingContact.",
  "credentialingContact.",
  "contractingSigner.",
];

export type RefreshPdfTokenValues = (
  baseValues: Readonly<Record<string, string>>,
  isCurrent?: () => boolean,
) => Promise<Record<string, string>>;

function isFillTimeToken(token: string): boolean {
  return FILL_TIME_TOKEN_FAMILIES.some((prefix) => token.startsWith(prefix));
}

export function mergeCurrentUserAndContactTokens(
  baseValues: Readonly<Record<string, string>>,
  profile: Awaited<ReturnType<typeof getMyProfile>>,
  user: { email: string | null; userMetadata: Record<string, unknown> | null },
  orgParties: readonly OrgParty[],
): Record<string, string> {
  const defaults = new Map<PartyRoleKey, OrgParty["party"]>();
  for (const row of orgParties) {
    for (const role of row.defaultRoleKeys) defaults.set(role, row.party);
  }
  const userValues = resolveUserTokenValues(profile, user);
  const contactValues = resolveOrgContactTokens(defaults);
  const values = Object.fromEntries(
    Object.entries(baseValues).filter(([token]) => !isFillTimeToken(token)),
  );
  for (const { token, value } of userValues.tokens) {
    if (value) values[token] = value;
  }
  for (const { token, value } of contactValues.tokens) {
    if (value) values[token] = value;
  }
  return values;
}

/** Refresh the actor and current org-default contact holders immediately before
 * a real PDF generation. This deliberately bypasses page-load query caches. */
export function useFreshPdfTokenValues() {
  return useCallback(
    async (
      baseValues: Readonly<Record<string, string>>,
      isCurrent: () => boolean = () => true,
    ): Promise<Record<string, string>> => {
      const start = useAuthStore.getState();
      const orgId = start.activeOrgId;
      const user = start.user;
      if (!orgId || !user || !isCurrent()) {
        throw new Error("The fill context changed. Start a new fill in the current context.");
      }
      const snapshot: PdfActorContext = {
        orgId,
        userId: user.id,
        authGeneration: start.authGeneration,
        contextEpoch: start.contextEpoch,
      };

      const [profile, orgParties] = await Promise.all([getMyProfile(), listOrgParties()]);
      const current = useAuthStore.getState();
      if (
        !isCurrent() ||
        !isSamePdfActorContext(snapshot, {
          orgId: current.activeOrgId,
          userId: current.user?.id ?? null,
          authGeneration: current.authGeneration,
          contextEpoch: current.contextEpoch,
        })
      ) {
        throw new Error("The fill context changed. Start a new fill in the current context.");
      }

      return mergeCurrentUserAndContactTokens(
        baseValues,
        profile,
        { email: user.email ?? null, userMetadata: user.user_metadata ?? null },
        orgParties,
      );
    },
    [],
  );
}
