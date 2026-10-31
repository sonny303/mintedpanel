// NPI Registry (NPPES) lookups — MINT-110. Sanctioned /api surface: the
// registry API has no CORS, so the browser asks our server, which calls it.
import { authedApiFetch } from "@/services/authedApi";
import type {
  NpiRegistryLookupResult,
  NpiRegistrySearchInput,
  NpiRegistrySearchResult,
} from "@/lib/npiRegistry";

/** Individuals (NPI-1) matching a first and last name, optionally in a state. */
export function searchNpiRegistry(input: NpiRegistrySearchInput): Promise<NpiRegistrySearchResult> {
  return authedApiFetch<NpiRegistrySearchResult>("/api/npi-registry/search", {
    method: "POST",
    body: JSON.stringify({
      firstName: input.firstName,
      lastName: input.lastName,
      state: input.state || null,
    }),
  });
}

/** The registry record for one NPI, or `record: null` when it has none. */
export function lookupNpiRegistry(npi: string): Promise<NpiRegistryLookupResult> {
  return authedApiFetch<NpiRegistryLookupResult>("/api/npi-registry/lookup", {
    method: "POST",
    body: JSON.stringify({ npi }),
  });
}
