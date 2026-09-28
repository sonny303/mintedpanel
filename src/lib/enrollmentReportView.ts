import type { EnrollmentReportPage, EnrollmentReportProvider } from "@/types";

/** Merge provider keyset pages while keeping the first row for any repeated provider id. */
export function deriveEnrollmentReportProviders(
  pages: ReadonlyArray<Pick<EnrollmentReportPage, "providers">>,
): EnrollmentReportProvider[] {
  const seen = new Set<string>();
  return pages.flatMap((page) => page.providers).filter((provider) => {
    if (seen.has(provider.providerId)) return false;
    seen.add(provider.providerId);
    return true;
  });
}
