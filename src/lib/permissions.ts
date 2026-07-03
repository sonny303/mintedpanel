// Pure permission helpers and hooks derived from the active membership role.
// Centralizes all role-based UI gating so intent is explicit and future-proof.
import { useRole, type AppRole } from "./auth-store";

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
