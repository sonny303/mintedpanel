// 2026-10-20 — Shared Shell for public-facing onboarding routes (anon).
// Renders outside the standard app shell. Copied from
// src/routes/ssn-intake.$token.tsx so every unauthenticated page has the
// same branded look + accessibility (ShieldCheck logo, max-w-lg).
import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";

export function OnboardingShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-muted/40 px-4 py-10">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#1B4D3E] text-white">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <span className="text-[15px] font-semibold text-foreground">Minted Panel</span>
        </div>
        {children}
        <div className="mt-8 text-center text-[11px] text-muted-foreground">
          Powered by Minted Panel · Your information is encrypted and stored securely
        </div>
      </div>
    </div>
  );
}
