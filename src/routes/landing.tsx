// Public marketing landing page for Minted Panel Credentialing.
// Standalone single-page route; not part of the authenticated app shell.
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/landing')({
  component: LandingPage,
});

const MAILTO =
  'mailto:YOUREMAIL@DOMAIN.COM?subject=Minted%20Panel%20%E2%80%94%20Meeting%20Request';

function LandingPage() {
  return (
    <div className="min-h-screen bg-[#FDFDFC] text-[#1F2937] font-sans antialiased">
      {/* NAV */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur border-b border-[#E8E5E0]">
        <nav className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <a href="/landing" className="text-[18px] font-bold text-[#1B4D3E] tracking-tight">
            Minted Panel
          </a>
          <div className="flex items-center gap-6">
            <a
              href="/login"
              className="text-sm font-medium text-[#6B7280] hover:text-[#1F2937] transition-colors"
            >
              Login
            </a>
            <a
              href={MAILTO}
              className="bg-[#1B4D3E] text-white text-sm font-medium px-4 py-2 rounded-md hover:bg-[#164032] transition-colors"
            >
              Schedule a Meeting
            </a>
          </div>
        </nav>
      </header>

      {/* HERO */}
      <section className="py-24 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-[13px] uppercase tracking-widest text-[#1B4D3E] font-medium mb-4">
            Managed Credentialing & Contracting
          </p>
          <h1 className="text-[32px] md:text-[48px] font-bold text-[#1F2937] leading-tight">
            Your providers see patients. We get them on panels.
          </h1>
          <p className="text-[18px] text-[#6B7280] leading-relaxed mt-6 max-w-2xl mx-auto">
            Minted Panel handles every step of credentialing and contracting for physical therapy
            groups. Every payer, every state, every follow-up. You track it all in real time from
            your dashboard.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href={MAILTO}
              className="bg-[#1B4D3E] text-white text-base font-medium px-6 py-3 rounded-md hover:bg-[#164032] transition-colors"
            >
              Schedule a Meeting
            </a>
            <a
              href="/login"
              className="border border-[#E8E5E0] text-[#1F2937] text-base font-medium px-6 py-3 rounded-md hover:bg-[#F5F4F1] transition-colors"
            >
              Login to Dashboard
            </a>
          </div>
        </div>
      </section>

      {/* WHO IT'S FOR */}
      <section className="py-20 bg-[#F5F4F1]">
        <div className="px-6">
          <h2 className="text-[28px] font-semibold text-[#1F2937] text-center">
            Who We Work With
          </h2>
          <p className="text-base text-[#6B7280] mt-3 max-w-xl mx-auto text-center">
            We serve physical therapy organizations that are growing faster than their back office
            can keep up.
          </p>
          <div className="mt-12 max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
            <article className="bg-white border border-[#E8E5E0] rounded-md p-6">
              <h3 className="text-[18px] font-semibold text-[#1F2937]">
                Practice Owners & Operators
              </h3>
              <p className="text-[15px] text-[#6B7280] leading-relaxed mt-3">
                You're opening new locations, hiring providers, and entering new states.
                Credentialing bottlenecks cost you weeks of lost revenue per provider. Hand it to
                us and focus on growth.
              </p>
            </article>
            <article className="bg-white border border-[#E8E5E0] rounded-md p-6">
              <h3 className="text-[18px] font-semibold text-[#1F2937]">Credentialing Managers</h3>
              <p className="text-[15px] text-[#6B7280] leading-relaxed mt-3">
                You're buried in spreadsheets tracking 50+ cases across payers and states.
                Deadlines slip, follow-ups get missed, billing asks you the same question five
                times a day. We take the work off your plate and give you a dashboard instead.
              </p>
            </article>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="py-20 bg-[#FDFDFC]">
        <div className="max-w-4xl mx-auto px-6">
          <h2 className="text-[28px] font-semibold text-[#1F2937] text-center">How It Works</h2>
          <p className="text-base text-[#6B7280] mt-3 text-center">
            Three steps. No spreadsheets.
          </p>
          <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                n: '01',
                t: 'Hand off your credentialing',
                b: 'Share your provider roster and payer list. We handle onboarding, document collection, and all submissions.',
              },
              {
                n: '02',
                t: 'We manage every payer and state',
                b: 'Our team tracks applications, follows up on deadlines, manages CAQH attestations, and resolves payer issues. Every touch is logged.',
              },
              {
                n: '03',
                t: 'Track progress in real time',
                b: "Your dashboard shows every provider's status across every payer. No more Slack messages asking 'are they on panel yet?'",
              },
            ].map((s) => (
              <div key={s.n}>
                <div className="text-[32px] font-bold text-[#1B4D3E] leading-none">{s.n}</div>
                <h3 className="text-base font-semibold text-[#1F2937] mt-3">{s.t}</h3>
                <p className="text-[15px] text-[#6B7280] leading-relaxed mt-2">{s.b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-[#E8E5E0]">
        <div className="max-w-6xl mx-auto px-6 py-12 flex flex-col sm:flex-row gap-4 justify-between items-center">
          <p className="text-[13px] text-[#9CA3AF]">© 2026 Minted Panel Credentialing</p>
          <a
            href={MAILTO}
            className="text-[13px] font-medium text-[#1B4D3E] hover:underline"
          >
            Schedule a Meeting
          </a>
        </div>
      </footer>
    </div>
  );
}
