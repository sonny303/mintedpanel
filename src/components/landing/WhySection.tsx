// Full-width tinted band explaining the managed-service positioning.
import { Eyebrow } from "./Eyebrow";

const REASONS = [
  {
    title: "Dedicated to healthcare providers",
    copy: "We work exclusively with healthcare provider groups, so we understand your payers, state requirements, and the credentialing issues that slow provider organizations down.",
  },
  {
    title: "Proactive, not reactive",
    copy: "We monitor open applications, follow up on missing information, and escalate stalled cases to keep files moving.",
  },
  {
    title: "Full transparency, always",
    copy: "Every action is logged. You can see each case's status, what's been submitted, and what still needs attention.",
  },
  {
    title: "Your team stays lean",
    copy: "You get enterprise-grade credentialing infrastructure without hiring an in-house specialist for every 50 providers.",
  },
];

export function WhySection() {
  return (
    <section className="bg-[#1B4D3E]/10 py-20">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center">
          <Eyebrow>Why Minted Panel</Eyebrow>
          <h2 className="mt-4 text-[28px] md:text-[32px] font-bold text-[#1F2937] tracking-tight">
            A managed service, not a software subscription
          </h2>
          <p className="mt-4 text-[16px] text-[#6B7280] max-w-3xl mx-auto">
            Minted Panel is not credentialing software that just stores files. We are a managed
            service — our team does the work, and you get visibility through the dashboard.
          </p>
        </div>
        <div className="mt-10 bg-white border border-[#E8E5E0] rounded-md p-8 grid gap-8 md:grid-cols-2">
          {REASONS.map((r) => (
            <div key={r.title}>
              <h3 className="text-[17px] font-semibold text-[#1F2937]">{r.title}</h3>
              <p className="mt-2 text-[15px] text-[#6B7280] leading-relaxed">{r.copy}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
