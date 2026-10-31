// NPI Registry (NPPES) help under a provider's NPI field — MINT-110. Two jobs:
//   1. Verify: once the NPI passes the check digit, say whether the registry
//      has it and whether the name staff typed matches. Every outcome is a
//      note, never an error — a missing record, a different name or the
//      registry being down never stops a save.
//   2. Search: look up individuals by the form's first and last name (plus an
//      optional state) and let staff pick one. Picking fills the NPI only.
// Used by Add Provider (ProviderFormSections) and the roster form. Composition
// of stock primitives, logged in DESIGN-DEBT.md.
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { CircleCheck, Search, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StateSelect } from "@/components/StateSelect";
import {
  useNpiRegistryLookup,
  useNpiRegistrySearch,
  usePrimeNpiRegistryLookup,
} from "@/hooks/useNpiRegistry";
import { isValidNpi } from "@/lib/providerIdentity";
import {
  NPI_REGISTRY_QUERY_REJECTED_MESSAGE,
  NPI_REGISTRY_RATE_LIMIT_MESSAGE,
  NPI_REGISTRY_UNAVAILABLE_MESSAGE,
  npiSearchStatusText,
  npiVerificationView,
  registryDisplayName,
  validateNpiRegistrySearch,
  type NpiLookupState,
  type NpiRegistryRecord,
  type NpiRegistrySearchInput,
  type NpiSearchState,
  type NpiVerificationView,
} from "@/lib/npiRegistry";
import { cn } from "@/lib/utils";

// The failures staff can act on — the rate limit, and the registry refusing
// the query (a 422) — keep their own message; anything else (an outage, an
// expired session, a dropped connection) reads as the registry being
// unavailable.
const ACTIONABLE_MESSAGES: ReadonlySet<string> = new Set([
  NPI_REGISTRY_RATE_LIMIT_MESSAGE,
  NPI_REGISTRY_QUERY_REJECTED_MESSAGE,
]);

function errorMessage(error: unknown): string {
  return error instanceof Error && ACTIONABLE_MESSAGES.has(error.message)
    ? error.message
    : NPI_REGISTRY_UNAVAILABLE_MESSAGE;
}

/** The verification line. Not a live region: the NPI input points at it with
 * aria-describedby, and NpiRegistryAssist announces result changes itself. */
export function NpiVerificationNotice({
  id,
  view,
}: {
  id: string;
  view: NpiVerificationView | null;
}) {
  return (
    <div id={id} className="text-[12px]">
      {view ? (
        <div className="flex items-start gap-1.5">
          {view.tone === "ok" ? (
            <CircleCheck
              aria-hidden="true"
              className="mt-px h-4 w-4 shrink-0 text-[var(--mp-ok-ink)]"
            />
          ) : view.tone === "warn" ? (
            <TriangleAlert
              aria-hidden="true"
              className="mt-px h-4 w-4 shrink-0 text-[var(--mp-warn-ink)]"
            />
          ) : null}
          <p>
            <span
              className={cn(
                "font-medium",
                view.tone === "warn" ? "text-[var(--mp-warn-ink)]" : "text-foreground",
              )}
            >
              {view.title}
            </span>
            {view.detail ? <span className="text-muted-foreground"> {view.detail}</span> : null}
          </p>
        </div>
      ) : null}
    </div>
  );
}

// Up/Down/Home/End move between the result buttons; Enter or Space picks.
function moveFocus(event: KeyboardEvent<HTMLUListElement>) {
  const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
  if (buttons.length === 0) return;
  event.preventDefault();
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  let next = 0;
  if (event.key === "End") next = buttons.length - 1;
  else if (event.key === "ArrowDown")
    next = current < 0 ? 0 : Math.min(buttons.length - 1, current + 1);
  else if (event.key === "ArrowUp") next = current <= 0 ? 0 : current - 1;
  buttons[next]?.focus();
}

/** The picked-from list: one button per individual. Each button's name is
 * its visible text (name first, so it matches what sighted users read and say
 * — WCAG 2.5.3), plus hidden context for screen readers. */
export function NpiRegistryResultList({
  results,
  onPick,
}: {
  results: NpiRegistryRecord[];
  onPick: (record: NpiRegistryRecord) => void;
}) {
  if (results.length === 0) return null;
  return (
    <ul
      aria-label="NPI Registry matches"
      onKeyDown={moveFocus}
      className="divide-y divide-border rounded-md border border-border"
    >
      {results.map((record) => (
        <li key={record.npi}>
          <button
            type="button"
            onClick={() => onPick(record)}
            className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-[13px] hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
          >
            <span className="flex w-full items-baseline justify-between gap-2">
              <span className="font-medium text-foreground">
                {registryDisplayName(record)}
                {record.credential ? `, ${record.credential}` : ""}
              </span>{" "}
              <span className="font-mono text-[12px] text-muted-foreground">
                <span className="sr-only">NPI </span>
                {record.npi}
              </span>
            </span>{" "}
            <span className="text-[12px] text-muted-foreground">
              {[
                record.primaryTaxonomy?.description,
                [record.practiceCity, record.practiceState].filter(Boolean).join(", "),
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <span className="sr-only">, use this NPI</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export interface NpiRegistryAssistProps {
  /** The NPI field's value with dashes and spaces already stripped. */
  npi: string;
  firstName: string;
  lastName: string;
  /** False while an edit form still holds the stored NPI: an unchanged NPI is
   * not re-checked (the same rule as the MINT-7 check digit). */
  verify: boolean;
  /** Fill the form's NPI. Nothing else on the form changes. */
  onPick: (npi: string) => void;
  /** The verification note's id; the NPI input names it in aria-describedby. */
  noticeId: string;
}

export function NpiRegistryAssist({
  npi,
  firstName,
  lastName,
  verify,
  onPick,
  noticeId,
}: NpiRegistryAssistProps) {
  const stateId = useId();
  const searchButton = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState("");
  const [submitted, setSubmitted] = useState<NpiRegistrySearchInput | null>(null);

  const checkable = verify && isValidNpi(npi) ? npi : null;
  const lookup = useNpiRegistryLookup(checkable);
  const lookupState: NpiLookupState =
    checkable === null
      ? { status: "idle" }
      : lookup.isError
        ? { status: "error", message: errorMessage(lookup.error) }
        : lookup.data
          ? { status: "done", record: lookup.data.record }
          : { status: "loading" };
  const view = npiVerificationView(lookupState, { firstName, lastName });

  // Announce the check only when its result changes (a new NPI, or loading →
  // found / not found / unavailable) — never on a name keystroke, even though
  // the note itself follows the typed name. Updated during render from the
  // previous key, so no effect is needed.
  const announceKey = checkable === null ? "idle" : `${checkable}:${lookupState.status}`;
  const [announced, setAnnounced] = useState({ key: announceKey, text: "" });
  if (announced.key !== announceKey) {
    setAnnounced({
      key: announceKey,
      text: view ? [view.title, view.detail].filter(Boolean).join(". ") : "",
    });
  }

  const search = useNpiRegistrySearch(submitted);
  const primeLookup = usePrimeNpiRegistryLookup();
  const searchState: NpiSearchState =
    submitted === null
      ? { status: "idle" }
      : search.isError
        ? { status: "error", message: errorMessage(search.error) }
        : search.data
          ? { status: "done", result: search.data }
          : { status: "loading" };

  const searchCheck = validateNpiRegistrySearch({ firstName, lastName, state });

  const runSearch = () => {
    if (!searchCheck.ok) return;
    // The folded names (accents, suffixes and periods removed) are what the
    // registry is asked for.
    const next = searchCheck.value;
    // The same search after a failure is a retry: the key does not change,
    // so ask again explicitly.
    const same =
      submitted !== null &&
      submitted.firstName === next.firstName &&
      submitted.lastName === next.lastName &&
      (submitted.state ?? null) === next.state;
    if (same && search.isError) {
      void search.refetch();
      return;
    }
    setSubmitted(next);
  };

  const pick = (record: NpiRegistryRecord) => {
    primeLookup(record);
    onPick(record.npi);
    setSubmitted(null);
    searchButton.current?.focus();
  };

  return (
    <div className="mt-2 space-y-2">
      <NpiVerificationNotice id={noticeId} view={view} />
      <p role="status" aria-live="polite" className="sr-only">
        {announced.text}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={stateId} className="sr-only">
          NPI Registry search state
        </label>
        <StateSelect
          id={stateId}
          value={state}
          onChange={setState}
          placeholder="Any state"
          className="h-8 w-28 text-[13px]"
        />
        <Button
          ref={searchButton}
          type="button"
          variant="outline"
          size="sm"
          disabled={!searchCheck.ok}
          onClick={runSearch}
        >
          <Search aria-hidden="true" className="h-4 w-4" />
          Search NPI Registry
        </Button>
        {!searchCheck.ok ? (
          <span className="text-[12px] text-muted-foreground">{searchCheck.error}</span>
        ) : null}
      </div>
      <p role="status" aria-live="polite" className="text-[12px] text-muted-foreground">
        {npiSearchStatusText(searchState)}
      </p>
      {searchState.status === "done" ? (
        <NpiRegistryResultList results={searchState.result.results} onPick={pick} />
      ) : null}
    </div>
  );
}
