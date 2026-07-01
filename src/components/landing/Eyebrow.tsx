// Small uppercase eyebrow label shared across landing sections.
import type { ReactNode } from 'react';

export function Eyebrow({ children, center = false }: { children: ReactNode; center?: boolean }) {
  return (
    <div
      className={`inline-block text-[12px] font-semibold uppercase tracking-[0.14em] text-[#1B4D3E] bg-[#1B4D3E]/10 rounded px-3 py-1 ${
        center ? 'mx-auto' : ''
      }`}
    >
      {children}
    </div>
  );
}
