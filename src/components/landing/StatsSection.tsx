// Three-stat capability strip below the hero.
const STATS = [
  { value: '50+', label: 'Payers Managed', copy: 'Commercial, Medicare, and Medicaid networks' },
  { value: '50', label: 'All 50 States', copy: 'Multi-state credentialing without the complexity' },
  { value: '100%', label: 'Follow-Through', copy: 'Tracked until the provider is active and billing' },
];

export function StatsSection() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-16">
      <div className="grid gap-8 md:grid-cols-3 text-center">
        {STATS.map((s) => (
          <div key={s.label}>
            <div className="text-[48px] font-bold text-[#1B4D3E] tracking-tight leading-none">
              {s.value}
            </div>
            <div className="mt-3 text-[16px] font-semibold text-[#1F2937]">{s.label}</div>
            <p className="mt-2 text-[14px] text-[#6B7280] max-w-[260px] mx-auto">{s.copy}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
