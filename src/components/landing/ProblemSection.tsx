// Problem framing with dark/light comparison cards + abstract graphic.
import { Eyebrow } from "./Eyebrow";
import { HeroGraphic } from "./HeroGraphic";

const OLD_WAY = [
  "Manual spreadsheet tracking",
  "Missed payer deadlines",
  "Providers waiting weeks to see patients",
  "Billing team chasing status daily",
];
const NEW_WAY = [
  "Dedicated team manages every case end-to-end",
  "Proactive deadline tracking and follow-up",
  "Faster in-network activation",
  "Real-time dashboard for your team",
];

export function ProblemSection() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-20 grid gap-12 md:grid-cols-2 items-start">
      <div>
        <Eyebrow>The Problem We Solve</Eyebrow>
        <h2 className="mt-4 text-[28px] md:text-[32px] font-bold text-[#1F2937] tracking-tight">
          Credentialing delays are a revenue problem
        </h2>
        <p className="mt-4 text-[16px] text-[#6B7280] leading-relaxed">
          Every week a provider sits uncredentialed is a week of revenue you can't collect. For a
          mid-volume medical practice, even one delayed case can mean thousands in lost or delayed
          revenue. Multiply that across a growing roster, and the cost adds up fast.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-md bg-[#1B4D3E] text-white p-5">
            <div className="text-[15px] font-semibold">The old way</div>
            <ul className="mt-3 space-y-2 text-[14px] text-white/90">
              {OLD_WAY.map((i) => (
                <li key={i}>• {i}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-md border border-[#E8E5E0] bg-white p-5">
            <div className="text-[15px] font-semibold text-[#1F2937]">The Minted Panel way</div>
            <ul className="mt-3 space-y-2 text-[14px] text-[#1F2937]">
              {NEW_WAY.map((i) => (
                <li key={i}>• {i}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      <div className="flex justify-center md:justify-end">
        <HeroGraphic className="w-full max-w-[420px] h-auto" />
      </div>
    </section>
  );
}
