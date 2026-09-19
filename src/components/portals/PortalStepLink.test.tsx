import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Portal } from "@/types";

const queryState = vi.hoisted(() => ({
  value: {
    data: [] as Portal[],
    isLoading: false,
    isError: false,
  },
}));

vi.mock("@/hooks/usePortals", () => ({ usePortals: () => queryState.value }));
vi.mock("./PortalVerificationPill", () => ({
  PortalVerificationPill: () => <span>Verified</span>,
}));
vi.mock("@/components/cases/WorkInPortalButton", () => ({
  WorkInPortalButton: (props: {
    facilityId?: string;
    disabled?: boolean;
    disabledReason?: string;
    target: { url: string };
  }) => (
    <>
      <button
        type="button"
        disabled={props.disabled}
        data-facility-id={props.facilityId ?? "omitted"}
      >
        Work in portal
      </button>
      <a href={props.target.url}>Open portal directly</a>
      {props.disabledReason ? <span>{props.disabledReason}</span> : null}
    </>
  ),
}));

import { PortalStepLink, type PortalHandoffContext } from "./PortalStepLink";

const PRIMARY_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SECONDARY_ID = "11111111-2222-4333-8444-555555555555";

const portal: Portal = {
  id: "99999999-aaaa-4bbb-8ccc-dddddddddddd",
  orgId: "20563fd6-8e95-46a0-8e1c-cb3b968b3c3d",
  portalKey: "regional_enrollment",
  name: "Regional Enrollment",
  payerId: null,
  formUrl: "https://portal.example/enroll",
  isVerified: true,
  lastVerifiedAt: null,
  urlChangedAt: null,
  createdAt: "2026-09-18T00:00:00Z",
  updatedAt: "2026-09-18T00:00:00Z",
};

function handoff(overrides: Partial<PortalHandoffContext> = {}): PortalHandoffContext {
  return {
    caseId: "b7a90000-0000-4000-a000-0000000000c1",
    providerId: "49ad83a8-d8b6-419d-8dcc-88c04a54c4da",
    orgId: "20563fd6-8e95-46a0-8e1c-cb3b968b3c3d",
    caseFacilityId: PRIMARY_ID,
    facilityLoadState: "ready",
    facilities: [
      { id: PRIMARY_ID, name: "Main" },
      { id: SECONDARY_ID, name: "Uptown" },
    ],
    selectedFacilityId: SECONDARY_ID,
    onSelectFacility: () => undefined,
    ...overrides,
  };
}

beforeEach(() => {
  queryState.value = { data: [portal], isLoading: false, isError: false };
});

describe("PortalStepLink mounted variants", () => {
  it("preserves the ordinary contextless Open portal link without mounting Work in portal", () => {
    // TaskDrawer intentionally passes no handoff for a locked or completed step.
    const html = renderToStaticMarkup(<PortalStepLink portalKey="regional_enrollment" />);
    expect(html).toContain("Open portal");
    expect(html).not.toContain("Work in portal");
    expect(html).toContain('href="https://portal.example/enroll"');
  });

  it("mounts the handoff action with the explicit secondary and a separate direct link", () => {
    const html = renderToStaticMarkup(
      <PortalStepLink portalKey="regional_enrollment" handoff={handoff()} />,
    );
    expect(html).toContain("Work in portal");
    expect(html).toContain('data-facility-id="11111111-2222-4333-8444-555555555555"');
    expect(html).toContain("Open portal directly");
  });

  it("disables handoff on a failed facility read while retaining direct navigation", () => {
    const html = renderToStaticMarkup(
      <PortalStepLink
        portalKey="regional_enrollment"
        handoff={handoff({ facilityLoadState: "error" })}
      />,
    );
    expect(html).toContain('<button type="button" disabled=""');
    expect(html).toContain("Open portal directly");
  });

  it("renders a recovery picker for a stale selection when one valid location remains", () => {
    const html = renderToStaticMarkup(
      <PortalStepLink
        portalKey="regional_enrollment"
        handoff={handoff({
          caseFacilityId: "99999999-8888-4777-8666-555555555555",
          facilities: [{ id: PRIMARY_ID, name: "Main" }],
          selectedFacilityId: undefined,
        })}
      />,
    );
    expect(html).toContain('aria-label="Location for this work"');
    expect(html).toContain("The selected location is no longer available");
    expect(html).toContain('<button type="button" disabled=""');
  });

  it("does not guess a target when the registry is loading, failed, missing, or has no URL", () => {
    queryState.value = { data: [portal], isLoading: true, isError: false };
    expect(
      renderToStaticMarkup(<PortalStepLink portalKey="regional_enrollment" handoff={handoff()} />),
    ).toBe("");

    queryState.value = { data: [portal], isLoading: false, isError: true };
    const failed = renderToStaticMarkup(
      <PortalStepLink portalKey="regional_enrollment" handoff={handoff()} />,
    );
    expect(failed).toContain("Portal registry unavailable");
    expect(failed).not.toContain("Work in portal");

    queryState.value = { data: [], isLoading: false, isError: false };
    const missing = renderToStaticMarkup(
      <PortalStepLink portalKey="regional_enrollment" handoff={handoff()} />,
    );
    expect(missing).toContain("Portal not set up");
    expect(missing).not.toContain("Work in portal");

    queryState.value = {
      data: [{ ...portal, formUrl: null }],
      isLoading: false,
      isError: false,
    };
    const noUrl = renderToStaticMarkup(
      <PortalStepLink portalKey="regional_enrollment" handoff={handoff()} />,
    );
    expect(noUrl).toContain("Portal URL not set");
    expect(noUrl).not.toContain("Work in portal");
  });

  it.each([
    "http://portal.example/enroll",
    "not a URL",
    "https://user:secret@portal.example/enroll",
  ])("does not mount handoff or direct navigation for unsafe registry URL %s", (formUrl) => {
    queryState.value = {
      data: [{ ...portal, formUrl }],
      isLoading: false,
      isError: false,
    };
    const mounted = renderToStaticMarkup(
      <PortalStepLink portalKey="regional_enrollment" handoff={handoff()} />,
    );
    const contextless = renderToStaticMarkup(<PortalStepLink portalKey="regional_enrollment" />);
    expect(mounted).toContain("Portal URL is unavailable for handoff");
    expect(mounted).not.toContain("Work in portal");
    expect(mounted).not.toContain("Open portal directly");
    expect(contextless).not.toContain("Open portal");
  });
});
