// Login page: 46/54 split. Deep-green left panel with dot texture, logo
// tile, headline and watermark. Off-white right panel with sign-in form.
import { createFileRoute, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuthStore } from "@/lib/auth-store";
import { useLandingRedirect } from "@/hooks/useLandingRedirect";
import logoAsset from "@/assets/minted-mark.png.asset.json";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

const FONT = { fontFamily: '"Geist", ui-sans-serif, system-ui, sans-serif' };

function LoginPage() {
  const goToLanding = useLandingRedirect();
  const session = useAuthStore((s) => s.session);
  const signIn = useAuthStore((s) => s.signIn);
  const loading = useAuthStore((s) => s.loading);
  const initialized = useAuthStore((s) => s.initialized);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Guards the resolver against re-firing while it navigates away from /login.
  const redirected = useRef(false);

  useEffect(() => {
    if (initialized && session && pathname === "/login" && !redirected.current) {
      // Redesign E0.4 TE-1: resolve the landing (last-active org workspace, or the
      // Portfolio fallback), superseding E0.0's flat /portfolio default.
      redirected.current = true;
      void goToLanding();
    }
  }, [initialized, session, pathname, goToLanding]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const result = await signIn(email.trim(), password);
    if (result.error) {
      setError(result.error);
      return;
    }
    redirected.current = true;
    await goToLanding();
  }

  return (
    <div className="min-h-dvh w-full flex" style={FONT}>
      {/* LEFT 46% */}
      <div
        className="relative hidden md:flex flex-col justify-between overflow-hidden"
        style={{
          flex: "0 0 46%",
          backgroundColor: "var(--mp-primary)",
          padding: "48px",
        }}
      >
        {/* Dot texture */}
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.10) 1px, transparent 1px)",
            backgroundSize: "26px 26px",
          }}
        />
        {/* Watermark */}
        <img
          src={logoAsset.url}
          alt=""
          aria-hidden="true"
          className="absolute pointer-events-none select-none"
          style={{
            width: "620px",
            right: "-180px",
            bottom: "-120px",
            opacity: 0.12,
            filter: "brightness(4)",
          }}
        />

        {/* Top: logo + wordmark */}
        <div className="relative flex items-center gap-3">
          <div
            className="flex items-center justify-center"
            style={{
              width: "44px",
              height: "44px",
              backgroundColor: "#FCFBF7",
              borderRadius: "12px",
            }}
          >
            <img
              src={logoAsset.url}
              alt="Minted Panel"
              style={{ width: "28px", height: "28px", objectFit: "contain" }}
            />
          </div>
          <span style={{ fontSize: "19px", fontWeight: 700, color: "#FCFBF7" }}>Minted Panel</span>
        </div>

        {/* Bottom: headline */}
        <div className="relative" style={{ maxWidth: "400px" }}>
          <h2
            style={{
              fontSize: "40px",
              fontWeight: 600,
              lineHeight: 1.15,
              color: "#F0EFE6",
              margin: 0,
            }}
          >
            Credentialing, handled.
          </h2>
          <p
            style={{
              marginTop: "20px",
              fontSize: "17px",
              fontWeight: 400,
              color: "rgba(240,239,230,0.75)",
              lineHeight: 1.5,
            }}
          >
            {"\n"}
          </p>
        </div>
      </div>

      {/* RIGHT 54% */}
      <div
        className="flex-1 flex items-center justify-center px-6"
        style={{ backgroundColor: "var(--mp-app)" }}
      >
        <form onSubmit={onSubmit} noValidate style={{ width: "360px" }}>
          <h1 style={{ fontSize: "28px", fontWeight: 600, color: "var(--mp-ink)", margin: 0 }}>
            Sign in
          </h1>
          <p style={{ marginTop: "8px", fontSize: "15px", color: "var(--mp-ink-secondary)" }}>
            Use your Minted Panel credentials.
          </p>

          <div style={{ marginTop: "34px", display: "flex", flexDirection: "column", gap: "20px" }}>
            <div>
              <label
                htmlFor="email"
                style={{
                  display: "block",
                  fontSize: "14px",
                  fontWeight: 600,
                  color: "var(--mp-ink)",
                  marginBottom: "8px",
                }}
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{
                  width: "100%",
                  height: "46px",
                  padding: "0 14px",
                  fontSize: "15px",
                  backgroundColor: "#FFFFFF",
                  border: `1px solid ${error ? "var(--mp-danger)" : "var(--mp-border)"}`,
                  borderRadius: "var(--mp-radius-lg)",
                  color: "var(--mp-ink)",
                  outline: "none",
                  ...FONT,
                }}
              />
            </div>

            <div>
              <div className="flex items-center justify-between" style={{ marginBottom: "8px" }}>
                <label
                  htmlFor="password"
                  style={{ fontSize: "14px", fontWeight: 600, color: "var(--mp-ink)" }}
                >
                  Password
                </label>
                <a
                  href="#"
                  style={{
                    fontSize: "13px",
                    fontWeight: 500,
                    color: "var(--mp-primary)",
                    textDecoration: "none",
                  }}
                >
                  Forgot password?
                </a>
              </div>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{
                  width: "100%",
                  height: "46px",
                  padding: "0 14px",
                  fontSize: "15px",
                  backgroundColor: "#FFFFFF",
                  border: `1px solid ${error ? "var(--mp-danger)" : "var(--mp-border)"}`,
                  borderRadius: "var(--mp-radius-lg)",
                  color: "var(--mp-ink)",
                  outline: "none",
                  ...FONT,
                }}
              />
            </div>

            {error ? (
              <div
                role="alert"
                style={{
                  fontSize: "13px",
                  color: "var(--mp-danger)",
                  backgroundColor: "var(--mp-danger-tint)",
                  border: "1px solid color-mix(in srgb, var(--mp-danger) 30%, white)",
                  borderRadius: "var(--mp-radius-lg)",
                  padding: "10px 12px",
                }}
              >
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              onMouseEnter={(e) =>
                (e.currentTarget.style.backgroundColor = "var(--mp-primary-hover)")
              }
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "var(--mp-primary)")}
              style={{
                width: "100%",
                height: "48px",
                backgroundColor: "var(--mp-primary)",
                color: "#FFFFFF",
                fontSize: "15px",
                fontWeight: 600,
                borderRadius: "var(--mp-radius-lg)",
                border: "none",
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.7 : 1,
                ...FONT,
              }}
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
