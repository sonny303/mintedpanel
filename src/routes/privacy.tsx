// Public privacy policy page — the hosted policy URL required by the Chrome
// Web Store listing for the Minted Panel Workbench extension.
// Content mirrors docs/privacy-policy.md: edit that document first, then keep
// this page in sync.
// Fully public: __root.tsx lists /privacy as a public route (no session
// redirect) and renders it outside AppShell, so nothing here may depend on
// auth or org context.
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import logoAsset from "@/assets/minted-mark.png.asset.json";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [{ title: "Privacy Policy — Minted Panel" }],
  }),
  component: PrivacyPage,
});

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mt-10 text-lg font-semibold text-foreground">{children}</h2>;
}

function Body({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{children}</p>;
}

function Lead({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-foreground">{children}</strong>;
}

function Bullets({ children }: { children: ReactNode }) {
  return (
    <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-muted-foreground">
      {children}
    </ul>
  );
}

function PrivacyPage() {
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-[760px] items-center px-6 py-4">
          <Link to="/" className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#1B4A38]">
              <img
                src={logoAsset.url}
                alt=""
                className="w-[22px] brightness-0 invert"
                style={{ objectFit: "contain" }}
              />
            </div>
            <span className="text-[15px] font-bold text-foreground">Minted Panel</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[760px] px-6 pb-24 pt-12">
        <h1 className="text-3xl font-semibold text-foreground">Privacy Policy</h1>

        <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
          <Lead>Effective date:</Lead> September 1, 2026
          <br />
          <Lead>Applies to:</Lead> the Minted Panel web application and the Minted Panel Workbench
          browser extension (together, "the Service").
        </p>

        <Body>
          Minted Panel, LLC ("we," "us") provides Minted Panel, a credentialing and contracting
          management platform for healthcare practice groups. This policy explains what information
          the Service handles and how.
        </Body>

        <SectionTitle>Information we handle</SectionTitle>
        <Bullets>
          <li>
            <Lead>Account information.</Lead> Name and email, used to sign you in.
          </li>
          <li>
            <Lead>Provider credentialing data.</Lead> Information your organization enters about its
            healthcare providers: names, dates of birth, professional identifiers (NPI, CAQH ID,
            license numbers), education, addresses, and the last four digits of Social Security
            numbers only. This data belongs to your organization and is visible only within it.
          </li>
          <li>
            <Lead>Activity records.</Lead> Actions taken in the Service (form fills, submissions,
            status changes, edits), logged with who performed them and when.
          </li>
        </Bullets>

        <SectionTitle>How the browser extension works</SectionTitle>
        <Body>
          The Minted Panel Workbench extension fills insurance payer enrollment forms using your
          organization's provider data.
        </Body>
        <Bullets>
          <li>Works only after you sign in.</li>
          <li>
            Retrieves your organization's provider data over an encrypted connection and enters it
            into supported payer portal forms.
          </li>
          <li>Writes to forms only. It does not read, collect, or transmit page content.</li>
          <li>Never submits a form. You review and submit every application yourself.</li>
          <li>Session data is cleared when you close your browser.</li>
          <li>Records each fill and confirmed submission to your organization's audit trail.</li>
        </Bullets>

        <SectionTitle>How we use information</SectionTitle>
        <Body>
          We use this information only to operate the Service: signing you in, filling forms you
          request, keeping your organization's records, and maintaining audit trails.
        </Body>
        <Body>
          We do not sell it. We do not use it for advertising. We do not use it to determine
          creditworthiness or for lending purposes. We do not transfer it to third parties except
          the service providers below, or as required by law.
        </Body>

        <SectionTitle>Service providers</SectionTitle>
        <Body>
          We run the Service on established infrastructure providers, currently Vercel (application
          hosting) and Supabase (database and authentication). These providers process data on our
          behalf under their own security and privacy commitments. Data is encrypted in transit.
        </Body>

        <SectionTitle>Data retention and deletion</SectionTitle>
        <Body>
          We retain your organization's data while it uses the Service. If your organization ends
          its use, we delete its data within 30 days of termination or a written deletion request,
          unless required by law to keep it longer.
        </Body>

        <SectionTitle>Not a HIPAA business associate</SectionTitle>
        <Body>
          The Service does not create, receive, or transmit patient medical records or other
          protected health information. We are not a HIPAA covered entity or business associate with
          respect to the data described in this policy.
        </Body>

        <SectionTitle>Changes to this policy</SectionTitle>
        <Body>
          If we make material changes, we will update this page and the effective date above.
        </Body>

        <SectionTitle>Contact</SectionTitle>
        <Body>
          Questions about this policy:{" "}
          <a href="mailto:surapurs@gmail.com" className="text-foreground underline">
            surapurs@gmail.com
          </a>
        </Body>
      </main>
    </div>
  );
}
