// Pull quote plus three benefit cards.
const CARDS = [
  { title: 'No more status chasing', copy: 'Your team stops asking where providers stand. The dashboard shows it first.' },
  { title: 'Revenue protection', copy: 'Faster credentialing means faster billing. Every week saved is a week of collections retained.' },
  { title: 'Peace of mind at scale', copy: 'As you add providers and states, your credentialing process scales with you automatically.' },
];

export function TestimonialSection() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-20">
      <blockquote className="border-l-4 border-[#1B4D3E] pl-6 py-2 max-w-4xl">
        <p className="text-[18px] md:text-[20px] text-[#1F2937] leading-relaxed italic">
          "We were opening two new locations at the same time and had five providers waiting to
          credential. Minted Panel took it off our plate, and we didn't lose a week of billing on
          either opening."
        </p>
        <footer className="mt-4">
          <div className="text-[14px] font-semibold text-[#1F2937]">
            — Practice Owner, Multi-Site Healthcare Group
          </div>
          <div className="text-[12px] text-[#9CA3AF] mt-1">Illustrative example</div>
        </footer>
      </blockquote>
      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {CARDS.map((c) => (
          <div key={c.title} className="border-l-2 border-[#1B4D3E] border-t border-r border-b border-t-[#E8E5E0] border-r-[#E8E5E0] border-b-[#E8E5E0] rounded-r-md bg-white p-6">
            <h3 className="text-[17px] font-semibold text-[#1F2937]">{c.title}</h3>
            <p className="mt-2 text-[14px] text-[#6B7280] leading-relaxed">{c.copy}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
