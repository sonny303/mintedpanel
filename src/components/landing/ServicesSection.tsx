// Six-item services grid with lucide icons in green chips.
import { FileText, Handshake, RefreshCw, Map, AlarmClock, BarChart3 } from "lucide-react";
import { Eyebrow } from "./Eyebrow";

const ITEMS = [
  {
    icon: FileText,
    title: "Provider Enrollment",
    copy: "Initial applications submitted to target payers commercial, Medicare, and Medicaid with full document management.",
  },
  {
    icon: Handshake,
    title: "Payer Contracting",
    copy: "We manage payer contracts so your providers stay in-network and billing at the right rates.",
  },
  {
    icon: RefreshCw,
    title: "CAQH Management",
    copy: "Ongoing attestation and updates so providers stay active and never miss a re-attestation.",
  },
  {
    icon: Map,
    title: "Multi-State Licensing",
    copy: "Coordinated state license management as you expand into new markets.",
  },
  {
    icon: AlarmClock,
    title: "Deadline Tracking",
    copy: "Every deadline, re-credentialing cycle, and expiration date is tracked proactively.",
  },
  {
    icon: BarChart3,
    title: "Real-Time Dashboard",
    copy: "A live view of every provider's status across every payer for your whole team.",
  },
];

export function ServicesSection() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-20">
      <Eyebrow>What We Handle</Eyebrow>
      <h2 className="mt-4 text-[28px] md:text-[32px] font-bold text-[#1F2937] tracking-tight">
        End-to-end credentialing and contracting services
      </h2>
      <p className="mt-4 text-[16px] text-[#6B7280] max-w-3xl">
        Minted Panel covers the full lifecycle from enrollment to ongoing maintenance, so nothing
        falls through the cracks.
      </p>
      <div className="mt-10 grid gap-6 md:grid-cols-2">
        {ITEMS.map((it) => (
          <div
            key={it.title}
            className="border border-[#E8E5E0] rounded-md bg-white p-6 flex gap-4"
          >
            <div className="w-11 h-11 shrink-0 rounded-md border border-[#1B4D3E]/20 bg-[#1B4D3E]/10 flex items-center justify-center">
              <it.icon className="w-5 h-5 text-[#1B4D3E]" />
            </div>
            <div>
              <h3 className="text-[17px] font-semibold text-[#1F2937]">{it.title}</h3>
              <p className="mt-1 text-[14px] text-[#6B7280] leading-relaxed">{it.copy}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
