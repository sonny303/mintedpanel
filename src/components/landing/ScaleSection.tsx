// Built-for-scale copy with three tier cards.
import { Eyebrow } from './Eyebrow';

const TIERS = [
  { title: 'Single-Site Practices', copy: 'Build a strong credentialing foundation as you grow.' },
  { title: 'Multi-Location Groups', copy: 'Manage expansion without adding back-office headcount.' },
  { title: 'Enterprise Provider Networks', copy: 'High-volume credentialing and contracting at scale.' },
];

export function ScaleSection() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-20">
      <Eyebrow>Built For Scale</Eyebrow>
      <h2 className="mt-4 text-[28px] md:text-[32px] font-bold text-[#1F2937] tracking-tight">
        From one location to fifty, we grow with you
      </h2>
      <div className="mt-4 space-y-4 max-w-3xl">
        <p className="text-[16px] text-[#6B7280] leading-relaxed">
          Minted Panel is built for healthcare provider organizations in motion. Whether you're
          credentialing one provider or managing a 200-provider roster across 12 locations, our
          infrastructure and team scale with you.
        </p>
        <p className="text-[16px] text-[#6B7280] leading-relaxed">
          We support single-site practices ready to expand and regional or national provider
          networks that have outgrown in-house credentialing. Our process is consistent, documented,
          and built for volume.
        </p>
      </div>
      <div className="mt-10 grid gap-6 md:grid-cols-3">
        {TIERS.map((t) => (
          <div key={t.title} className="border border-[#E8E5E0] rounded-md bg-white p-6">
            <h3 className="text-[17px] font-semibold text-[#1F2937]">{t.title}</h3>
            <p className="mt-2 text-[14px] text-[#6B7280] leading-relaxed">{t.copy}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
