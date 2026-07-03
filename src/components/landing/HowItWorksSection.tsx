// Three numbered process cards.
import { Eyebrow } from "./Eyebrow";

const STEPS = [
  {
    title: "Hand off your credentialing",
    copy: "Share your provider roster and payer targets. We handle onboarding, document collection, CAQH management, and initial submissions.",
  },
  {
    title: "We manage every payer and state",
    copy: "We track open applications, follow up on pending decisions, manage CAQH re-attestations, and resolve payer issues. Every touchpoint is logged in your account.",
  },
  {
    title: "Track progress in real time",
    copy: "Your dashboard shows every provider's credentialing and contracting status across payers, updated in real time. Your team always knows where things stand.",
  },
];

export function HowItWorksSection() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-20">
      <Eyebrow>How It Works</Eyebrow>
      <h2 className="mt-4 text-[28px] md:text-[32px] font-bold text-[#1F2937] tracking-tight">
        Three steps to fully managed credentialing
      </h2>
      <p className="mt-4 text-[16px] text-[#6B7280] max-w-3xl">
        Our process keeps your team focused. You share what we need & we handle the rest, from
        submission to active network status.
      </p>
      <div className="mt-10 grid gap-6 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <div key={s.title} className="border border-[#E8E5E0] rounded-md bg-white p-6">
            <div className="w-10 h-10 rounded-full bg-[#1B4D3E] text-white font-semibold flex items-center justify-center text-[16px]">
              {i + 1}
            </div>
            <h3 className="mt-4 text-[18px] font-semibold text-[#1F2937]">{s.title}</h3>
            <p className="mt-2 text-[15px] text-[#6B7280] leading-relaxed">{s.copy}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
