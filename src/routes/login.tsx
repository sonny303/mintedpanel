// Login page: Minted Panel branding on the deep-green left panel with logo,
// dotted texture, and oversized watermark. Email + password form on the right.
import { createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthStore } from "@/lib/auth-store";
import logoAsset from "@/assets/minted-logo.png.asset.json";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const session = useAuthStore((s) => s.session);
  const signIn = useAuthStore((s) => s.signIn);
  const loading = useAuthStore((s) => s.loading);
  const initialized = useAuthStore((s) => s.initialized);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialized && session && pathname === "/login") {
      navigate({ to: "/cases" });
    }
  }, [initialized, session, pathname, navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const result = await signIn(email.trim(), password);
    if (result.error) {
      setError(result.error);
      return;
    }
    navigate({ to: "/cases" });
  }

  return (
    <div className="min-h-dvh w-full grid grid-cols-1 md:grid-cols-2 bg-[#FAF7F0]">
      <div
        className="relative hidden md:flex flex-col justify-between p-10 text-white overflow-hidden"
        style={{ backgroundColor: "#1B4D3E" }}
      >
        {/* Dotted texture */}
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage: "radial-gradient(rgba(255,255,255,0.35) 1px, transparent 1px)",
            backgroundSize: "18px 18px",
          }}
          aria-hidden="true"
        />
        {/* Oversized watermark logo */}
        <img
          src={logoAsset.url}
          alt=""
          aria-hidden="true"
          className="absolute -bottom-24 -left-16 w-[520px] opacity-20 pointer-events-none select-none"
        />

        <div className="relative flex items-center gap-3">
          <div className="h-11 w-11 rounded-lg bg-white flex items-center justify-center">
            <img src={logoAsset.url} alt="Minted Panel logo" className="h-7 w-7 object-contain" />
          </div>
          <span className="text-[20px] font-semibold tracking-tight">Minted Panel</span>
        </div>

        <div className="relative">
          <h2 className="text-[44px] leading-[1.05] font-semibold tracking-tight max-w-sm">
            Credentialing, kept in order.
          </h2>
        </div>
      </div>

      <div className="flex items-center justify-center p-8">
        <form onSubmit={onSubmit} className="w-full max-w-sm space-y-6" noValidate>
          <div>
            <h1 className="text-[24px] font-semibold tracking-tight text-foreground">
              Sign in
            </h1>
            <p className="mt-1 text-[14px] text-muted-foreground">
              Use your Minted Panel credentials.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@organization.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive"
            >
              {error}
            </div>
          ) : null}

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
