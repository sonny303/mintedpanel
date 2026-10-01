import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const queryState = vi.hoisted(() => ({
  value: { data: null as unknown, isPending: false, isError: false },
}));

vi.mock("@/hooks/useExactPortalConfiguration", () => ({
  useExactPortalConfiguration: () => queryState.value,
}));
vi.mock("@/components/cases/WorkInPortalButton", () => ({
  WorkInPortalButton: (props: {
    facilityId?: string;
    disabled?: boolean;
    disabledReason?: string;
    target: { name: string; url: string };
  }) => (
    <>
      <button type="button" disabled={props.disabled} data-facility-id={props.facilityId ?? "none"}>
        Legacy work in portal
      </button>
      <a href={props.target.url}>Open portal directly</a>
      {props.disabledReason ? <span>{props.disabledReason}</span> : null}
    </>
  ),
}));
vi.mock("@/components/cases/WorkInPortalV2Button", () => ({
  WorkInPortalV2Button: (props: {
    tuple: Record<string, unknown>;
    portalUrl: string;
    disabled?: boolean;
    disabledReason?: string;
  }) => (
    <div
      data-testid="exact-work-button"
      data-owner-kind={props.tuple.ownerKind}
      data-owner-id={props.tuple.ownerId}
      data-step-id={props.tuple.stepId}
      data-facility-id={props.tuple.facilityId ?? "none"}
      data-portal-url={props.portalUrl}
      data-disabled={String(Boolean(props.disabled))}
    >
      Work in portal
      {props.disabledReason ? <span>{props.disabledReason}</span> : null}
    </div>
  ),
}));

import { PortalStepLink, type PortalHandoffContext } from "./PortalStepLink";

const ORG_ID = "20563fd6-8e95-46a0-8e1c-cb3b968b3c3d";
const CASE_ID = "b7a90000-0000-4000-a000-0000000000c1";
const PROVIDER_ID = "49ad83a8-d8b6-419d-8dcc-88c04a54c4da";
const PAYER_ID = "b7a90000-0000-4000-a000-0000000000c9";
const PRIMARY_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SECONDARY_ID = "11111111-2222-4333-8444-555555555555";

function configuration(overrides: Record<string, unknown> = {}) {
  return {
    portalKey: "regional_enrollment",
    portalId: "b7a90000-0000-4000-a000-0000000000c4",
    ownerScope: "organization",
    ownerOrgId: ORG_ID,
    caseType: "enrollment",
    payerId: PAYER_ID,
    formUrl: "https://portal.example/enroll",
    requiresExplicitSelection: true,
    mappingGeneration: 9,
    effectiveMappingFingerprint: "fingerprint-v2",
    maps: [],
    activeFieldCount: 1,
    isVerified: true,
    isReady: true,
    status: "ready",
    ...overrides,
  };
}

function handoff(overrides: Partial<PortalHandoffContext> = {}): PortalHandoffContext {
  return {
    caseId: CASE_ID,
    providerId: PROVIDER_ID,
    orgId: ORG_ID,
    caseType: "enrollment",
    caseStatus: "in_progress",
    contextVersion: 4,
    payerId: PAYER_ID,
    caseFacilityId: PRIMARY_ID,
    facilityLoadState: "ready",
    facilities: [
      { id: PRIMARY_ID, name: "Main" },
      { id: SECONDARY_ID, name: "Uptown" },
    ],
    selectedFacilityId: SECONDARY_ID,
    onSelectFacility: () => undefined,
    workStep: {
      taskId: "b7a90000-0000-4000-a000-0000000000c5",
      taskExecutionType: "extension_fill",
      sopTemplateId: "b7a90000-0000-4000-a000-0000000000c3",
      sopVersion: 3,
      stepId: "b7a90000-0000-4000-a000-0000000000c6",
      stepIdentity: `${CASE_ID}:b7a90000-0000-4000-a000-0000000000c5:b7a90000-0000-4000-a000-0000000000c3:3:b7a90000-0000-4000-a000-0000000000c6`,
    },
    ...overrides,
  };
}

beforeEach(() => {
  queryState.value = { data: configuration(), isPending: false, isError: false };
});

describe("PortalStepLink mounted variants", () => {
  it("keeps legacy contextless navigation available for configurations without exact selection", () => {
    queryState.value.data = configuration({ requiresExplicitSelection: false });
    const html = renderToStaticMarkup(<PortalStepLink portalKey="regional_enrollment" />);
    expect(html).toContain("Open portal");
    expect(html).not.toContain("Work in portal");
    expect(html).toContain('href="https://portal.example/enroll"');
  });

  it("mounts exact case work with the current step, selected facility, config and canonical URL", () => {
    const html = renderToStaticMarkup(
      <PortalStepLink portalKey="regional_enrollment" handoff={handoff()} />,
    );
    expect(html).toContain('data-testid="exact-work-button"');
    expect(html).toContain('data-owner-kind="case"');
    expect(html).toContain(`data-owner-id="${CASE_ID}"`);
    expect(html).toContain('data-step-id="b7a90000-0000-4000-a000-0000000000c6"');
    expect(html).toContain(`data-facility-id="${SECONDARY_ID}"`);
    expect(html).toContain('data-portal-url="https://portal.example/enroll"');
    expect(html).not.toContain("Open portal directly");
  });

  it("supports the same exact handoff for Recredentialing cases", () => {
    queryState.value.data = configuration({ caseType: "recredentialing" });
    const html = renderToStaticMarkup(
      <PortalStepLink
        portalKey="regional_enrollment"
        handoff={handoff({ caseType: "recredentialing" })}
      />,
    );
    expect(html).toContain('data-testid="exact-work-button"');
    expect(html).toContain('data-owner-kind="case"');
  });

  it("does not expose a contextless URL for an explicit-selection configuration", () => {
    const html = renderToStaticMarkup(<PortalStepLink portalKey="regional_enrollment" />);
    expect(html).not.toContain("Open portal");
    expect(html).toContain("Choose this portal from an exact case or Contract SOP step");
  });

  it("gates explicit-selection launch on extension_fill, an open case, and a ready exact resolver", () => {
    const nonExtensionTask = renderToStaticMarkup(
      <PortalStepLink
        portalKey="regional_enrollment"
        handoff={handoff({ workStep: { ...handoff().workStep!, taskExecutionType: "manual" } })}
      />,
    );
    expect(nonExtensionTask).not.toContain('data-testid="exact-work-button"');
    expect(nonExtensionTask).toContain("not enabled for the exact Extension work handoff");

    const closedCase = renderToStaticMarkup(
      <PortalStepLink
        portalKey="regional_enrollment"
        handoff={handoff({ caseStatus: "approved" })}
      />,
    );
    expect(closedCase).not.toContain('data-testid="exact-work-button"');
    expect(closedCase).toContain("case is not open");

    queryState.value.data = configuration({ isReady: false, status: "empty" });
    const unready = renderToStaticMarkup(
      <PortalStepLink portalKey="regional_enrollment" handoff={handoff()} />,
    );
    expect(unready).not.toContain('data-testid="exact-work-button"');
    expect(unready).toContain("exact portal configuration is not ready");
  });

  it("requires a current facility choice when the case has locations", () => {
    const html = renderToStaticMarkup(
      <PortalStepLink
        portalKey="regional_enrollment"
        handoff={handoff({ caseFacilityId: null, selectedFacilityId: undefined })}
      />,
    );
    expect(html).toContain('aria-label="Location for this work"');
    expect(html).toContain("Choose a location before sending this case to the extension.");
    expect(html).toMatch(
      /<button class="[^"]+" type="button" disabled="">Work in portal<\/button>/,
    );
  });

  it("preserves the old case flow only for legacy portal configurations", () => {
    queryState.value.data = configuration({ requiresExplicitSelection: false });
    const html = renderToStaticMarkup(
      <PortalStepLink portalKey="regional_enrollment" handoff={handoff()} />,
    );
    expect(html).toContain("Legacy work in portal");
    expect(html).toContain("Open portal directly");
  });

  it("does not guess when the resolver is loading, failed, missing, or has no safe URL", () => {
    queryState.value = { data: null, isPending: true, isError: false };
    expect(renderToStaticMarkup(<PortalStepLink portalKey="regional_enrollment" />)).toBe("");

    queryState.value = { data: null, isPending: false, isError: true };
    expect(renderToStaticMarkup(<PortalStepLink portalKey="regional_enrollment" />)).toContain(
      "Portal configuration unavailable",
    );

    queryState.value = { data: null, isPending: false, isError: false };
    expect(renderToStaticMarkup(<PortalStepLink portalKey="regional_enrollment" />)).toContain(
      "Portal not set up",
    );

    queryState.value.data = configuration({ formUrl: null });
    const missingUrl = renderToStaticMarkup(
      <PortalStepLink portalKey="regional_enrollment" handoff={handoff()} />,
    );
    expect(missingUrl).toContain("Portal URL or exact work context is unavailable");
    expect(missingUrl).not.toContain('data-testid="exact-work-button"');

    queryState.value.data = configuration({ formUrl: "http://portal.example/enroll" });
    const unsafe = renderToStaticMarkup(
      <PortalStepLink portalKey="regional_enrollment" handoff={handoff()} />,
    );
    expect(unsafe).not.toContain("Open portal directly");
    expect(unsafe).not.toContain('data-testid="exact-work-button"');
  });
});
