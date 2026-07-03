// Two-column audience section with lucide icons in green chips.
import { Building2, ClipboardList } from "lucide-react";
import { Eyebrow } from "./Eyebrow";

const CARDS = [
  {
    icon: Building2,
    title: "Practice Owners & Operators",
    copy: "You're expanding, hiring providers, and entering new states at the same time. Credentialing delays can cost weeks of lost revenue before a provider ever sees a patient.",
    bullets: [
      "New location and state expansions",
      "Provider onboarding",
      "Protect revenue during ramp-up",
    ],
  },
  {
    icon: ClipboardList,
    title: "Credentialing Managers",
    copy: "You're tracking dozens of active cases across payers and states. We replace manual follow-up with a real-time dashboard and a team that handles every touch.",
    bullets: [
      "Centralized case tracking",
      "Proactive deadlines and follow-up",
      "One source of truth for billing",
    ],
  },
];

export function AudienceSection() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-20">
      <Eyebrow>Who We Work With</Eyebrow>
      <h2 className="mt-4 text-[28px] md:text-[32px] font-bold text-[#1F2937] tracking-tight max-w-3xl">
        We serve healthcare provider groups growing faster than their back office can keep up
      </h2>
      <p className="mt-4 text-[16px] text-[#6B7280] max-w-3xl">
        Whether you're opening a new location or managing multiple credentialing cases at once,
        Minted Panel gives you the infrastructure to scale without the bottlenecks.
      </p>
      <div className="mt-10 grid gap-8 md:grid-cols-2">
        {CARDS.map((c) => (
          <div key={c.title} className="border border-[#E8E5E0] rounded-md bg-white p-6">
            <div className="w-11 h-11 rounded-md border border-[#1B4D3E]/20 bg-[#1B4D3E]/10 flex items-center justify-center">
              <c.icon className="w-5 h-5 text-[#1B4D3E]" />
            </div>
            <h3 className="mt-4 text-[18px] font-semibold text-[#1F2937]">{c.title}</h3>
            <p className="mt-2 text-[15px] text-[#6B7280] leading-relaxed">{c.copy}</p>
            <ul className="mt-4 space-y-1.5 text-[14px] text-[#1F2937]">
              {c.bullets.map((b) => (
                <li key={b} className="flex gap-2">
                  <span className="text-[#1B4D3E] mt-1">•</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
