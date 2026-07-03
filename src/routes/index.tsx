// Public marketing landing page for Minted Panel Credentialing.
// Ported from the reference design: brand-green hero with dot texture, live-status card, and section blocks.
import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/lib/auth-store";
import logoAsset from "@/assets/minted-mark.png.asset.json";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    const { session } = useAuthStore.getState();
    if (session) {
      throw redirect({ to: "/providers", replace: true });
    }
  },
  component: LandingPage,
});

const FONT: React.CSSProperties = {
  fontFamily: '"Instrument Sans", ui-sans-serif, system-ui, sans-serif',
};

const DOT_TEXTURE: React.CSSProperties = {
  backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.10) 1px, transparent 1px)",
  backgroundSize: "26px 26px",
};

const LOGO = logoAsset.url;

type Reveal = { style?: React.CSSProperties };

function useReveal(delay = 0) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setShown(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setTimeout(() => setShown(true), delay);
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [delay]);
  return {
    ref,
    style: {
      opacity: shown ? 1 : 0,
      transform: shown ? "none" : "translateY(26px)",
      transition: "opacity .8s ease, transform .8s cubic-bezier(.16,1,.3,1)",
      willChange: "opacity, transform",
    } as React.CSSProperties,
  };
}

function LandingPage() {
  return (
    <div style={{ ...FONT, background: "#FAF9F5", color: "#14301f", minHeight: "100dvh" }}>
      <Nav />
      <Hero />
      <Stats />
      <WhoWeWorkWith />
      <Problem />
      <HowItWorks />
      <WhatWeHandle />
      <BuiltForScale />
      <WhyMintedPanel />
      <FinalCTA />
      <Footer />
    </div>
  );
}

function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "rgba(250,249,245,0.88)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderBottom: `1px solid ${scrolled ? "rgba(20,48,31,0.10)" : "rgba(20,48,31,0)"}`,
        boxShadow: scrolled ? "0 4px 20px rgba(20,48,31,0.06)" : "none",
        transition: "border-color .3s ease, box-shadow .3s ease",
      }}
    >
      <div
        style={{
          maxWidth: 1120,
          margin: "0 auto",
          padding: "16px 32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: "#1B4A38",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <img src={LOGO} alt="" style={{ width: 24, filter: "brightness(0) invert(1)" }} />
          </div>
          <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em" }}>
            Minted Panel
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link
            to="/login"
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "#1B4A38",
              textDecoration: "none",
              padding: "10px 16px",
              borderRadius: 10,
            }}
          >
            Log in
          </Link>
          <a
            href="#cta"
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "#FCFBF7",
              background: "#1B4A38",
              textDecoration: "none",
              padding: "10px 18px",
              borderRadius: 10,
              transition: "background .2s ease",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#143A2B")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "#1B4A38")}
          >
            Schedule a meeting
          </a>
        </div>
      </div>
    </div>
  );
}

function Hero() {
  const [scrollY, setScrollY] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const words = "Your providers see patients. We get them on panels.".split(" ");
  const [wordsShown, setWordsShown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWordsShown(true), 120);
    return () => clearTimeout(t);
  }, []);

  const sub = useReveal(200);
  const ctas = useReveal(300);
  const card = useReveal(450);
  const eyebrow = useReveal(0);

  return (
    <div style={{ background: "#1B4A38", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, ...DOT_TEXTURE }} />
      <div
        style={{
          position: "absolute",
          width: 640,
          right: -170,
          bottom: -150,
          opacity: 0.12,
          marginBottom: `${-scrollY * 0.12}px`,
          animation: "mpFloatSlow 9s ease-in-out infinite",
        }}
      >
        <img src={LOGO} alt="" style={{ width: "100%", filter: "brightness(4)" }} />
      </div>
      <style>{`@keyframes mpFloatSlow { 0% { transform: translateY(0) rotate(0deg);} 50% { transform: translateY(-18px) rotate(2deg);} 100% { transform: translateY(0) rotate(0deg);} }`}</style>

      <div
        style={{
          maxWidth: 1120,
          margin: "0 auto",
          padding: "110px 32px 120px",
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 56,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 280 }}>
          <div
            ref={eyebrow.ref}
            style={{
              ...eyebrow.style,
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.14em",
              color: "rgba(240,239,230,0.65)",
              marginBottom: 22,
            }}
          >
            MANAGED CREDENTIALING &amp; CONTRACTING
          </div>
          <h1
            style={{
              fontSize: "clamp(40px, 6vw, 64px)",
              fontWeight: 600,
              color: "#F0EFE6",
              letterSpacing: "-0.025em",
              lineHeight: 1.08,
              margin: "0 0 24px",
              maxWidth: 700,
            }}
          >
            {words.map((w, i) => (
              <span
                key={`${w}-${i}`}
                style={{
                  display: "inline-block",
                  marginRight: "0.28em",
                  opacity: wordsShown ? 1 : 0,
                  transform: wordsShown ? "none" : "translateY(30px)",
                  transition: `opacity .7s ease ${i * 80}ms, transform .7s cubic-bezier(.16,1,.3,1) ${i * 80}ms`,
                }}
              >
                {w}
              </span>
            ))}
          </h1>
          <p
            ref={sub.ref}
            style={{
              ...sub.style,
              fontSize: 19,
              color: "rgba(240,239,230,0.75)",
              lineHeight: 1.55,
              margin: "0 0 40px",
              maxWidth: 560,
            }}
          >
            Minted Panel handles credentialing and contracting for healthcare provider groups across
            payers and states, so your team can focus on care.
          </p>
          <div ref={ctas.ref} style={{ ...ctas.style, display: "flex", gap: 14, flexWrap: "wrap" }}>
            <a
              href="#cta"
              style={{
                display: "inline-flex",
                alignItems: "center",
                height: 52,
                padding: "0 28px",
                background: "#FCFBF7",
                color: "#1B4A38",
                fontSize: 16,
                fontWeight: 600,
                borderRadius: 12,
                textDecoration: "none",
                transition: "transform .2s ease, box-shadow .2s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.25)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "none";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              Schedule a Meeting
            </a>
            <Link
              to="/login"
              style={{
                display: "inline-flex",
                alignItems: "center",
                height: 52,
                padding: "0 28px",
                border: "1px solid rgba(252,251,247,0.35)",
                color: "#FCFBF7",
                fontSize: 16,
                fontWeight: 600,
                borderRadius: 12,
                textDecoration: "none",
                transition: "border-color .2s ease, background .2s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "rgba(252,251,247,0.8)";
                e.currentTarget.style.background = "rgba(252,251,247,0.06)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "rgba(252,251,247,0.35)";
                e.currentTarget.style.background = "transparent";
              }}
            >
              Login to Dashboard
            </Link>
          </div>
        </div>
        <div ref={card.ref} style={{ ...card.style, flex: "0 0 296px", maxWidth: "100%" }}>
          <LiveStatusCard />
        </div>
      </div>
    </div>
  );
}

const STATES = [
  { t: "Submitted", bg: "#EFEDE3", c: "#55605a", w: "18%", bc: "#C9C6BA", hold: 1700 },
  { t: "Under review", bg: "#F5EBD7", c: "#96552B", w: "58%", bc: "#C98A4B", hold: 1700 },
  { t: "✓ In-network", bg: "#DCEEE2", c: "#1B4A38", w: "100%", bc: "#1B4A38", hold: 3200 },
];

function LiveStatusCard() {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setIdx(2);
      return;
    }
    const t = setTimeout(() => setIdx((i) => (i + 1) % STATES.length), STATES[idx].hold);
    return () => clearTimeout(t);
  }, [idx]);
  const s = STATES[idx];
  return (
    <div
      style={{
        background: "#FDFCF9",
        borderRadius: 16,
        padding: "22px 22px 24px",
        boxShadow: "0 24px 64px rgba(0,0,0,0.35)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: "#96A09A" }}>
          LIVE STATUS
        </div>
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "#2E8B5F",
            boxShadow: "0 0 0 3px rgba(46,139,95,0.2)",
          }}
        />
      </div>
      <div style={{ fontSize: 17, fontWeight: 600, color: "#14301f", marginBottom: 3 }}>
        Dr. Sonny Ali
      </div>
      <div style={{ fontSize: 13, color: "#6B7370", marginBottom: 18 }}>
        Aetna · Texas · Case #4821
      </div>
      <div
        style={{
          height: 6,
          borderRadius: 3,
          background: "#ECE9DF",
          overflow: "hidden",
          marginBottom: 14,
        }}
      >
        <div
          style={{
            height: "100%",
            width: s.w,
            borderRadius: 3,
            background: s.bc,
            transition: "width .9s cubic-bezier(.16,1,.3,1), background .5s ease",
          }}
        />
      </div>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "6px 13px",
          borderRadius: 999,
          fontSize: 13,
          fontWeight: 600,
          background: s.bg,
          color: s.c,
          transition: "background .5s ease, color .5s ease",
        }}
      >
        {s.t}
      </div>
    </div>
  );
}

function CountUp({ target, suffix = "" }: { target: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [val, setVal] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setVal(target);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            const dur = 1200;
            const start = performance.now();
            const tick = (now: number) => {
              const t = Math.min(1, (now - start) / dur);
              const eased = 1 - Math.pow(1 - t, 3);
              setVal(Math.round(target * eased));
              if (t < 1) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [target]);
  return (
    <span ref={ref}>
      {val}
      {suffix}
    </span>
  );
}

function Stats() {
  const items = [
    {
      n: 15,
      suf: "+",
      label: "Payers Managed",
      copy: "Commercial, Medicare, and Medicaid networks",
      delay: 0,
    },
    {
      n: 50,
      suf: "",
      label: "All 50 States",
      copy: "Multi-state credentialing without the complexity",
      delay: 120,
    },
    {
      n: 100,
      suf: "%\u00a0",
      label: "Follow-Through",
      copy: "Tracked until the provider is active and billing",
      delay: 240,
    },
  ];
  return (
    <div style={{ borderBottom: "1px solid #E7E4DA" }}>
      <div
        style={{
          maxWidth: 1120,
          margin: "0 auto",
          padding: "56px 32px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 48,
        }}
      >
        {items.map((it) => {
          // eslint-disable-next-line react-hooks/rules-of-hooks -- pre-existing: map over a static array, hook order is stable
          const r = useReveal(it.delay);
          return (
            <div
              key={it.label}
              ref={r.ref}
              style={{ ...r.style, display: "flex", flexDirection: "column", gap: 6 }}
            >
              <div
                style={{
                  fontSize: 48,
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                  color: "#1B4A38",
                }}
              >
                <CountUp target={it.n} suffix={it.suf} />
              </div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{it.label}</div>
              <div style={{ fontSize: 14, color: "#6B7370" }}>{it.copy}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: "0.14em",
        color: "#1D5540",
        marginBottom: 16,
      }}
    >
      {children}
    </div>
  );
}

function HoverLiftCard({
  children,
  padding = 36,
  radius = 16,
}: {
  children: React.ReactNode;
  padding?: number;
  radius?: number;
}) {
  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #E7E4DA",
        borderRadius: radius,
        padding,
        transition: "transform .25s ease, box-shadow .25s ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-4px)";
        e.currentTarget.style.boxShadow = "0 12px 32px rgba(20,48,31,0.10)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "none";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      {children}
    </div>
  );
}

function WhoWeWorkWith() {
  const eyebrow = useReveal(0);
  const h = useReveal(80);
  const p = useReveal(160);
  const c1 = useReveal(0);
  const c2 = useReveal(120);
  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "100px 32px" }}>
      <div ref={eyebrow.ref} style={eyebrow.style}>
        <SectionEyebrow>WHO WE WORK WITH</SectionEyebrow>
      </div>
      <h2
        ref={h.ref}
        style={{
          ...h.style,
          fontSize: 40,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          lineHeight: 1.15,
          margin: "0 0 16px",
          maxWidth: 680,
        }}
      >
        We serve healthcare provider groups growing faster than their back office can keep up
      </h2>
      <p
        ref={p.ref}
        style={{
          ...p.style,
          fontSize: 17,
          color: "#6B7370",
          lineHeight: 1.6,
          margin: "0 0 48px",
          maxWidth: 640,
        }}
      >
        Whether you're opening a new location or managing multiple credentialing cases at once,
        Minted Panel gives you the infrastructure to scale without the bottlenecks.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 24,
        }}
      >
        <div ref={c1.ref} style={c1.style}>
          <HoverLiftCard>
            <div style={{ fontSize: 21, fontWeight: 600, marginBottom: 12 }}>
              Practice Owners &amp; Operators
            </div>
            <p style={{ fontSize: 15, color: "#55605a", lineHeight: 1.6, margin: "0 0 20px" }}>
              You're expanding, hiring providers, and entering new states at the same time.
              Credentialing delays can cost weeks of lost revenue before a provider ever sees a
              patient.
            </p>
            <BulletList
              items={[
                "New location and state expansions",
                "Provider onboarding",
                "Protect revenue during ramp-up",
              ]}
            />
          </HoverLiftCard>
        </div>
        <div ref={c2.ref} style={c2.style}>
          <HoverLiftCard>
            <div style={{ fontSize: 21, fontWeight: 600, marginBottom: 12 }}>
              Credentialing Managers
            </div>
            <p style={{ fontSize: 15, color: "#55605a", lineHeight: 1.6, margin: "0 0 20px" }}>
              You're tracking dozens of active cases across payers and states. We replace manual
              follow-up with a real-time dashboard and a team that handles every touch.
            </p>
            <BulletList
              items={[
                "Centralized case tracking",
                "Proactive deadlines and follow-up",
                "One source of truth for billing",
              ]}
            />
          </HoverLiftCard>
        </div>
      </div>
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {items.map((it) => (
        <div key={it} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 15 }}>
          <span style={{ color: "#1D5540", fontWeight: 700 }}>•</span>
          {it}
        </div>
      ))}
    </div>
  );
}

function Problem() {
  const eyebrow = useReveal(0);
  const h = useReveal(80);
  const p = useReveal(160);
  const oldCard = useReveal(0);
  const mpCard = useReveal(140);
  return (
    <div
      style={{
        background: "#F3F1E9",
        borderTop: "1px solid #E7E4DA",
        borderBottom: "1px solid #E7E4DA",
      }}
    >
      <div
        style={{
          maxWidth: 1120,
          margin: "0 auto",
          padding: "100px 32px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 72,
          alignItems: "start",
        }}
      >
        <div>
          <div ref={eyebrow.ref} style={eyebrow.style}>
            <SectionEyebrow>THE PROBLEM WE SOLVE</SectionEyebrow>
          </div>
          <h2
            ref={h.ref}
            style={{
              ...h.style,
              fontSize: 38,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              lineHeight: 1.15,
              margin: "0 0 20px",
            }}
          >
            Credentialing delays are a revenue problem
          </h2>
          <p
            ref={p.ref}
            style={{ ...p.style, fontSize: 16, color: "#55605a", lineHeight: 1.65, margin: 0 }}
          >
            Every week a provider sits uncredentialed is a week of revenue you can't collect. For a
            mid-volume medical practice, even one delayed case can mean thousands in lost or delayed
            revenue. Multiply that across a growing roster, and the cost adds up fast.
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div ref={oldCard.ref} style={oldCard.style}>
            <div
              style={{
                background: "#FFFFFF",
                border: "1px solid #E7E4DA",
                borderRadius: 16,
                padding: 28,
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 700, color: "#96552B", marginBottom: 14 }}>
                The old way
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 9,
                  fontSize: 15,
                  color: "#55605a",
                }}
              >
                {[
                  "Manual spreadsheet tracking",
                  "Missed payer deadlines",
                  "Providers waiting weeks to see patients",
                  "Billing team chasing status daily",
                ].map((t) => (
                  <div key={t} style={{ display: "flex", gap: 10 }}>
                    <span style={{ color: "#C0A48A" }}>✕</span>
                    {t}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div ref={mpCard.ref} style={mpCard.style}>
            <div
              style={{
                background: "#1B4A38",
                borderRadius: 16,
                padding: 28,
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div style={{ position: "absolute", inset: 0, ...DOT_TEXTURE }} />
              <div style={{ position: "relative" }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#FCFBF7", marginBottom: 14 }}>
                  The Minted Panel way
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 9,
                    fontSize: 15,
                    color: "rgba(240,239,230,0.85)",
                  }}
                >
                  {[
                    "Dedicated team manages every case end-to-end",
                    "Proactive deadline tracking and follow-up",
                    "Faster in-network activation",
                    "Real-time dashboard for your team",
                  ].map((t) => (
                    <div key={t} style={{ display: "flex", gap: 10 }}>
                      <span style={{ color: "#8FBFA5" }}>✓</span>
                      {t}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepLine({ delay }: { delay: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setDrawn(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setTimeout(() => setDrawn(true), delay);
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [delay]);
  return (
    <div
      ref={ref}
      style={{
        height: 3,
        background: "#1B4A38",
        transformOrigin: "left",
        marginBottom: 28,
        transform: drawn ? "scaleX(1)" : "scaleX(0)",
        transition: "transform .7s cubic-bezier(.16,1,.3,1)",
      }}
    />
  );
}

function HowItWorks() {
  const eyebrow = useReveal(0);
  const h = useReveal(80);
  const p = useReveal(160);
  const steps = [
    {
      n: 1,
      title: "Hand off your credentialing",
      copy: "Share your provider roster and payer targets. We handle onboarding, document collection, CAQH management, and initial submissions.",
      delay: 0,
    },
    {
      n: 2,
      title: "We manage every payer and state",
      copy: "We track open applications, follow up on pending decisions, manage CAQH re-attestations, and resolve payer issues. Every touchpoint is logged in your account.",
      delay: 120,
    },
    {
      n: 3,
      title: "Track progress in real time",
      copy: "Your dashboard shows every provider's credentialing and contracting status across payers, updated in real time. Your team always knows where things stand.",
      delay: 240,
    },
  ];
  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "100px 32px", position: "relative" }}>
      <img
        src={LOGO}
        alt=""
        style={{
          position: "absolute",
          width: 72,
          top: 70,
          right: 24,
          opacity: 0.09,
          transform: "rotate(-18deg)",
          pointerEvents: "none",
        }}
      />
      <img
        src={LOGO}
        alt=""
        style={{
          position: "absolute",
          width: 44,
          top: 240,
          right: 150,
          opacity: 0.07,
          transform: "rotate(14deg)",
          pointerEvents: "none",
        }}
      />
      <div ref={eyebrow.ref} style={eyebrow.style}>
        <SectionEyebrow>HOW IT WORKS</SectionEyebrow>
      </div>
      <h2
        ref={h.ref}
        style={{
          ...h.style,
          fontSize: 40,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          lineHeight: 1.15,
          margin: "0 0 16px",
        }}
      >
        Three steps to fully managed credentialing
      </h2>
      <p
        ref={p.ref}
        style={{
          ...p.style,
          fontSize: 17,
          color: "#6B7370",
          lineHeight: 1.6,
          margin: "0 0 48px",
          maxWidth: 620,
        }}
      >
        Our process keeps your team focused. You share what we need &amp; we handle the rest, from
        submission to active network status.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 24,
        }}
      >
        {steps.map((s) => {
          // eslint-disable-next-line react-hooks/rules-of-hooks -- pre-existing: map over a static array, hook order is stable
          const r = useReveal(s.delay);
          return (
            <div key={s.n} ref={r.ref} style={r.style}>
              <StepLine delay={(s.n - 1) * 350} />
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  background: "#1B4A38",
                  color: "#FCFBF7",
                  fontSize: 17,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 18,
                }}
              >
                {s.n}
              </div>
              <div style={{ fontSize: 19, fontWeight: 600, marginBottom: 10 }}>{s.title}</div>
              <p style={{ fontSize: 15, color: "#55605a", lineHeight: 1.6, margin: 0 }}>{s.copy}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WhatWeHandle() {
  const eyebrow = useReveal(0);
  const h = useReveal(80);
  const p = useReveal(160);
  const items = [
    [
      "Provider Enrollment",
      "Initial applications submitted to target payers — commercial, Medicare, and Medicaid — with full document management.",
    ],
    [
      "Payer Contracting",
      "We manage payer contracts so your providers stay in-network and billing at the right rates.",
    ],
    [
      "CAQH Management",
      "Ongoing attestation and updates so providers stay active and never miss a re-attestation.",
    ],
    [
      "Multi-State Licensing",
      "Coordinated state license management as you expand into new markets.",
    ],
    [
      "Deadline Tracking",
      "Every deadline, re-credentialing cycle, and expiration date is tracked proactively.",
    ],
    [
      "Real-Time Dashboard",
      "A live view of every provider's status across every payer for your whole team.",
    ],
  ];
  return (
    <div
      style={{
        background: "#F3F1E9",
        borderTop: "1px solid #E7E4DA",
        borderBottom: "1px solid #E7E4DA",
      }}
    >
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "100px 32px" }}>
        <div ref={eyebrow.ref} style={eyebrow.style}>
          <SectionEyebrow>WHAT WE HANDLE</SectionEyebrow>
        </div>
        <h2
          ref={h.ref}
          style={{
            ...h.style,
            fontSize: 40,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            lineHeight: 1.15,
            margin: "0 0 16px",
            maxWidth: 640,
          }}
        >
          End-to-end credentialing and contracting services
        </h2>
        <p
          ref={p.ref}
          style={{
            ...p.style,
            fontSize: 17,
            color: "#6B7370",
            lineHeight: 1.6,
            margin: "0 0 48px",
            maxWidth: 620,
          }}
        >
          Minted Panel covers the full lifecycle from enrollment to ongoing maintenance, so nothing
          falls through the cracks.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 20,
          }}
        >
          {items.map(([title, copy], i) => {
            // eslint-disable-next-line react-hooks/rules-of-hooks -- pre-existing: map over a static array, hook order is stable
            const r = useReveal((i % 3) * 80);
            return (
              <div key={title} ref={r.ref} style={r.style}>
                <div
                  style={{
                    background: "#FFFFFF",
                    border: "1px solid #E7E4DA",
                    borderRadius: 14,
                    padding: 28,
                    transition: "transform .25s ease, box-shadow .25s ease",
                    height: "100%",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "translateY(-3px)";
                    e.currentTarget.style.boxShadow = "0 10px 28px rgba(20,48,31,0.09)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "none";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                >
                  <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>{title}</div>
                  <p style={{ fontSize: 14, color: "#55605a", lineHeight: 1.6, margin: 0 }}>
                    {copy}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BuiltForScale() {
  const eyebrow = useReveal(0);
  const h = useReveal(80);
  const p1 = useReveal(160);
  const p2 = useReveal(220);
  const cards = [
    ["Single-Site Practices", "Build a strong credentialing foundation as you grow.", 0],
    ["Multi-Location Groups", "Manage expansion without adding back-office headcount.", 100],
    ["Enterprise Provider Networks", "High-volume credentialing and contracting at scale.", 200],
  ] as const;
  return (
    <div
      style={{
        maxWidth: 1120,
        margin: "0 auto",
        padding: "100px 32px",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
        gap: 72,
        alignItems: "center",
      }}
    >
      <div>
        <div ref={eyebrow.ref} style={eyebrow.style}>
          <SectionEyebrow>BUILT FOR SCALE</SectionEyebrow>
        </div>
        <h2
          ref={h.ref}
          style={{
            ...h.style,
            fontSize: 38,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            lineHeight: 1.15,
            margin: "0 0 20px",
          }}
        >
          From one location to fifty, we grow with you
        </h2>
        <p
          ref={p1.ref}
          style={{
            ...p1.style,
            fontSize: 16,
            color: "#55605a",
            lineHeight: 1.65,
            margin: "0 0 16px",
          }}
        >
          Minted Panel is built for healthcare provider organizations in motion. Whether you're
          credentialing one provider or managing a 200-provider roster across 12 locations, our
          infrastructure and team scale with you.
        </p>
        <p
          ref={p2.ref}
          style={{ ...p2.style, fontSize: 16, color: "#55605a", lineHeight: 1.65, margin: 0 }}
        >
          We support single-site practices ready to expand and regional or national provider
          networks that have outgrown in-house credentialing. Our process is consistent, documented,
          and built for volume.
        </p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {cards.map(([title, copy, delay]) => {
          // eslint-disable-next-line react-hooks/rules-of-hooks -- pre-existing: map over a static array, hook order is stable
          const r = useReveal(delay as number);
          return (
            <div
              key={title}
              ref={r.ref}
              style={{
                ...r.style,
                background: "#FFFFFF",
                border: "1px solid #E7E4DA",
                borderRadius: 14,
                padding: "24px 28px",
                transition: "transform .25s ease, border-color .25s ease, opacity .8s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateX(6px)";
                e.currentTarget.style.borderColor = "#1B4A38";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "none";
                e.currentTarget.style.borderColor = "#E7E4DA";
              }}
            >
              <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>{title}</div>
              <div style={{ fontSize: 14, color: "#55605a" }}>{copy}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WhyMintedPanel() {
  const eyebrow = useReveal(0);
  const h = useReveal(80);
  const testimonial = useReveal(0);
  const features = [
    [
      "Dedicated to healthcare providers",
      "We work exclusively with healthcare provider groups, so we understand your payers, state requirements, and the credentialing issues that slow provider organizations down.",
    ],
    [
      "Proactive, not reactive",
      "We monitor open applications, follow up on missing information, and escalate stalled cases to keep files moving.",
    ],
    [
      "Full transparency, always",
      "Every action is logged. You can see each case's status, what's been submitted, and what still needs attention.",
    ],
    [
      "Your team stays lean",
      "You get enterprise-grade credentialing infrastructure without hiring an in-house specialist for every 50 providers.",
    ],
  ];
  const minis = [
    [
      "No more status chasing",
      "Your team stops asking where providers stand. The dashboard shows it first.",
      0,
    ],
    [
      "Revenue protection",
      "Faster credentialing means faster billing. Every week saved is a week of collections retained.",
      100,
    ],
    [
      "Peace of mind at scale",
      "As you add providers and states, your credentialing process scales with you automatically.",
      200,
    ],
  ] as const;
  return (
    <div
      style={{
        background: "#F3F1E9",
        borderTop: "1px solid #E7E4DA",
        borderBottom: "1px solid #E7E4DA",
      }}
    >
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "100px 32px" }}>
        <div ref={eyebrow.ref} style={eyebrow.style}>
          <SectionEyebrow>WHY MINTED PANEL</SectionEyebrow>
        </div>
        <h2
          ref={h.ref}
          style={{
            ...h.style,
            fontSize: 40,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            lineHeight: 1.15,
            margin: "0 0 48px",
            maxWidth: 640,
          }}
        >
          A managed service, not a software subscription
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "40px 64px",
            marginBottom: 64,
          }}
        >
          {features.map(([title, copy], i) => {
            // eslint-disable-next-line react-hooks/rules-of-hooks -- pre-existing: map over a static array, hook order is stable
            const r = useReveal(i % 2 === 0 ? 0 : 80);
            return (
              <div key={title} ref={r.ref} style={r.style}>
                <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>{title}</div>
                <p style={{ fontSize: 15, color: "#55605a", lineHeight: 1.6, margin: 0 }}>{copy}</p>
              </div>
            );
          })}
        </div>
        <div
          ref={testimonial.ref}
          style={{
            ...testimonial.style,
            background: "#1B4A38",
            borderRadius: 20,
            padding: 56,
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div style={{ position: "absolute", inset: 0, ...DOT_TEXTURE }} />
          <img
            src={LOGO}
            alt=""
            style={{
              position: "absolute",
              width: 300,
              right: -70,
              top: -60,
              opacity: 0.1,
              filter: "brightness(4)",
            }}
          />
          <div style={{ position: "relative", maxWidth: 720 }}>
            <div
              style={{
                fontSize: 24,
                fontWeight: 500,
                color: "#F0EFE6",
                lineHeight: 1.45,
                letterSpacing: "-0.01em",
                marginBottom: 24,
              }}
            >
              "We were opening two new locations at the same time and had five providers waiting to
              credential. Minted Panel took it off our plate, and we didn't lose a week of billing
              on either opening."
            </div>
            <div style={{ fontSize: 15, color: "rgba(240,239,230,0.7)" }}>
              — Practice Owner, Multi-Site Healthcare Group ·{" "}
              <span style={{ fontStyle: "italic" }}>Illustrative example</span>
            </div>
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 24,
            marginTop: 48,
          }}
        >
          {minis.map(([title, copy, delay]) => {
            // eslint-disable-next-line react-hooks/rules-of-hooks -- pre-existing: map over a static array, hook order is stable
            const r = useReveal(delay as number);
            return (
              <div key={title} ref={r.ref} style={r.style}>
                <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>{title}</div>
                <p style={{ fontSize: 14, color: "#55605a", lineHeight: 1.6, margin: 0 }}>{copy}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function FinalCTA() {
  const h = useReveal(0);
  const p = useReveal(100);
  const c = useReveal(200);
  return (
    <div
      id="cta"
      style={{ maxWidth: 1120, margin: "0 auto", padding: "110px 32px", position: "relative" }}
    >
      <img
        src={LOGO}
        alt=""
        style={{
          position: "absolute",
          width: 64,
          top: 90,
          left: 40,
          opacity: 0.09,
          transform: "rotate(22deg)",
          pointerEvents: "none",
        }}
      />
      <img
        src={LOGO}
        alt=""
        style={{
          position: "absolute",
          width: 48,
          bottom: 80,
          right: 60,
          opacity: 0.08,
          transform: "rotate(-12deg)",
          pointerEvents: "none",
        }}
      />
      <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto" }}>
        <h2
          ref={h.ref}
          style={{
            ...h.style,
            fontSize: 44,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            lineHeight: 1.12,
            margin: "0 0 20px",
          }}
        >
          Ready to hand off your credentialing?
        </h2>
        <p
          ref={p.ref}
          style={{
            ...p.style,
            fontSize: 17,
            color: "#6B7370",
            lineHeight: 1.6,
            margin: "0 0 36px",
          }}
        >
          Schedule a brief call to review your provider roster and target payers. See how Minted
          Panel gets your providers in-network faster. Existing clients can log in to access their
          dashboard.
        </p>
        <div
          ref={c.ref}
          style={{
            ...c.style,
            display: "flex",
            gap: 14,
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <a
            href="#cta"
            style={{
              display: "inline-flex",
              alignItems: "center",
              height: 52,
              padding: "0 28px",
              background: "#1B4A38",
              color: "#FCFBF7",
              fontSize: 16,
              fontWeight: 600,
              borderRadius: 12,
              textDecoration: "none",
              transition: "transform .2s ease, box-shadow .2s ease, background .2s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-2px)";
              e.currentTarget.style.boxShadow = "0 8px 24px rgba(27,74,56,0.3)";
              e.currentTarget.style.background = "#143A2B";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "none";
              e.currentTarget.style.boxShadow = "none";
              e.currentTarget.style.background = "#1B4A38";
            }}
          >
            Schedule a Meeting
          </a>
          <Link
            to="/login"
            style={{
              display: "inline-flex",
              alignItems: "center",
              height: 52,
              padding: "0 28px",
              border: "1px solid #C9C6BA",
              color: "#1B4A38",
              fontSize: 16,
              fontWeight: 600,
              borderRadius: 12,
              textDecoration: "none",
              transition: "border-color .2s ease, background .2s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "#1B4A38";
              e.currentTarget.style.background = "rgba(27,74,56,0.05)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "#C9C6BA";
              e.currentTarget.style.background = "transparent";
            }}
          >
            Login to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

function Footer() {
  return (
    <div style={{ background: "#1B4A38" }}>
      <div
        style={{
          maxWidth: 1120,
          margin: "0 auto",
          padding: 32,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              background: "#FCFBF7",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <img src={LOGO} alt="" style={{ width: 20 }} />
          </div>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#FCFBF7" }}>Minted Panel</span>
        </div>
        <div style={{ fontSize: 13, color: "rgba(240,239,230,0.6)" }}>
          © 2026 Minted Panel Credentialing
        </div>
        <Link
          to="/login"
          style={{ fontSize: 14, fontWeight: 600, color: "#FCFBF7", textDecoration: "none" }}
        >
          Login
        </Link>
      </div>
    </div>
  );
}
