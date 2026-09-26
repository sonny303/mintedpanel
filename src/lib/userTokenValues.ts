import { composeFullName } from "@/lib/personName";

export interface UserTokenProfile {
  firstName?: string | null;
  lastName?: string | null;
  title?: string | null;
  fullName?: string | null;
  email?: string | null;
}

export interface UserTokenIdentity {
  email?: string | null;
  userMetadata?: Record<string, unknown> | null;
}

export interface ResolvedUserTokenValues {
  tokens: Array<{ token: string; value: string }>;
  notes: string[];
}

function clean(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function metadataString(
  meta: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = meta?.[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** Shared, client-safe token composition for authenticated user identity. */
export function resolveUserTokenValues(
  profile: UserTokenProfile | null,
  identity: UserTokenIdentity,
): ResolvedUserTokenValues {
  const notes: string[] = [];
  const firstName = clean(profile?.firstName);
  const lastName = clean(profile?.lastName);
  const title = clean(profile?.title);
  const name =
    clean(composeFullName({ firstName, lastName })) ??
    clean(profile?.fullName) ??
    metadataString(identity.userMetadata, "full_name") ??
    metadataString(identity.userMetadata, "name");
  const email = clean(identity.email) ?? clean(profile?.email);

  if (name == null) notes.push("user.name resolved to empty: set your name on the Account page");
  if (firstName == null) {
    notes.push("user.firstName resolved to empty: set your name on the Account page");
  }
  if (lastName == null)
    notes.push("user.lastName resolved to empty: set your name on the Account page");
  if (title == null) notes.push("user.title resolved to empty: set your title on the Account page");
  if (email == null) notes.push("user.email resolved to empty: the JWT carries no email claim");

  return {
    tokens: [
      { token: "user.name", value: name ?? "" },
      { token: "user.firstName", value: firstName ?? "" },
      { token: "user.lastName", value: lastName ?? "" },
      { token: "user.title", value: title ?? "" },
      { token: "user.email", value: email ?? "" },
    ],
    notes,
  };
}
