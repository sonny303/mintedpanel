// Pure permission helpers and hooks derived from the active membership role.
// Centralizes all role-based UI gating so intent is explicit and future-proof.
import { useRole, type AppRole } from "./auth-store";

/** Display labels for the three membership roles. Lives here (the role-semantics
 * module) rather than in a component, so the sidebar footer and the /account
 * page can never disagree about what a role is called. */
export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Admin",
  specialist: "Specialist",
  billing: "Billing",
};

/** What a role may do, in one plain sentence — shown on /account beside the
 * badge, because "Specialist" alone does not tell a user what they can do. */
export const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  admin: "Full access, including member management and organization settings.",
  specialist: "Can create and edit records, but cannot manage members or settings.",
  billing: "Read-only access.",
};

export function canWrite(role: AppRole | null | undefined): boolean {
  return role === "admin" || role === "specialist";
}

export function isAdmin(role: AppRole | null | undefined): boolean {
  return role === "admin";
}

export function useCanWrite(): boolean {
  return canWrite(useRole());
}

export function useIsAdmin(): boolean {
  return isAdmin(useRole());
}
