// Public privacy policy page — the hosted policy URL required by the Chrome
// Web Store listing for the Minted Panel Filler extension.
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
          <Lead>Applies to:</Lead> the Minted Panel web application and the Minted Panel Filler
          browser extension (together, "the Service").
        </p>

        <Body>
          Minted Panel, LLC ("we," "us") provides Minted Panel, a credentialing and contracting
          management platform for healthcare practice groups. This policy explains what information
          the Service handles and how.
        </Body>

        <SectionTitle>Who our users are</SectionTitle>
        <Body>
          Minted Panel is a business tool. Our users are credentialing staff at healthcare
          organizations. The information in the Service is about healthcare providers (such as
          physical therapists) being credentialed with insurance payers. The Service does not
          collect or store patient medical records.
        </Body>

        <SectionTitle>Information we handle</SectionTitle>
        <Body>
          <Lead>Account information.</Lead> Your name and email address, used to sign you in and to
          attribute your activity within your organization.
        </Body>
        <Body>
          <Lead>Provider credentialing data.</Lead> Information your organization enters about its
          healthcare providers, such as names, dates of birth, professional identifiers (NPI, CAQH
          ID, license numbers), education, addresses, and partial Social Security numbers (last four
          digits only; we never store full Social Security numbers). This data belongs to your
          organization and is visible only to members of your organization.
        </Body>
        <Body>
          <Lead>Activity records.</Lead> When you use the Service, we record actions such as form
          fills, submissions, status changes, and record edits, along with who performed them and
          when. These records exist so your organization has an accurate audit trail.
        </Body>

        <SectionTitle>How the browser extension works</SectionTitle>
        <Body>
          The Minted Panel Filler extension fills insurance payer enrollment forms using your
          organization's provider data.
        </Body>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-muted-foreground">
          <li>It works only after you sign in with your Minted Panel account.</li>
          <li>
            It requests your organization's provider data from our servers over an encrypted
            connection and enters it into form fields on supported payer websites.
          </li>
          <li>
            It writes to forms. It does not read, collect, or transmit the content of web pages you
            visit.
          </li>
          <li>It never submits a form. You review and submit every application yourself.</li>
          <li>
            Your session is kept in browser session storage and is cleared when you close your
            browser.
          </li>
          <li>
            It records each fill and each submission you confirm, so the activity appears in your
            organization's audit trail.
          </li>
        </ul>

        <SectionTitle>How we use information</SectionTitle>
        <Body>
          We use the information described above only to operate the Service: signing you in,
          filling forms you request, keeping your organization's records, and maintaining audit
          trails.
        </Body>
        <Body>
          We do not use it for advertising. We do not sell it. We do not use it to determine
          creditworthiness or for lending purposes. We do not transfer it to third parties except
          the infrastructure providers below, or as needed to comply with the law.
        </Body>

        <SectionTitle>Cookies and tracking</SectionTitle>
        <Body>
          The Service uses only the cookies and browser storage necessary to keep you signed in. We
          do not use advertising cookies, tracking pixels, or third-party analytics that follow you
          across other websites.
        </Body>

        <SectionTitle>Service providers</SectionTitle>
        <Body>
          We run the Service on established infrastructure providers, currently Vercel (application
          hosting) and Supabase (database and authentication). These providers process data on our
          behalf under their own security and privacy commitments. Data is encrypted in transit.
        </Body>

        <SectionTitle>Data retention and deletion</SectionTitle>
        <Body>
          Provider records and audit trails are retained while your organization uses the Service,
          because credentialing history has ongoing compliance value to your organization. If your
          organization ends its use of the Service, we delete its data within 30 days of termination
          or a written deletion request, unless we're required by law to keep it longer.
        </Body>

        <SectionTitle>Your organization's role</SectionTitle>
        <Body>
          Your organization controls the provider data it enters into the Service and decides who at
          the organization has access. Questions about specific records should go to your
          organization's administrator first.
        </Body>

        <SectionTitle>Your privacy rights</SectionTitle>
        <Body>
          Depending on your state, you may have rights to access, correct, or delete your
          information. To exercise these rights, contact us using the information below.
        </Body>

        <SectionTitle>Children's privacy</SectionTitle>
        <Body>
          The Service is a business tool for credentialing staff. It is not directed at, and we do
          not knowingly collect information from, anyone under 18.
        </Body>

        <SectionTitle>Not a HIPAA business associate</SectionTitle>
        <Body>
          The Service does not create, receive, or transmit patient medical records or other
          protected health information. We are not a HIPAA covered entity or business associate with
          respect to the data described in this policy.
        </Body>

        <SectionTitle>Security</SectionTitle>
        <Body>
          Access is scoped by organization. Sensitive fields are limited by design (for example,
          only the last four digits of Social Security numbers are ever stored). Reads of detailed
          provider records are logged. If a security incident affects your organization's data, we
          will notify your administrator without undue delay.
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
