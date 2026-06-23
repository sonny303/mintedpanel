// Login page: OpenPanel wordmark on the deep-green left panel, email + password
// form on the right. Shows an inline error on bad credentials.
import { createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthStore } from "@/lib/auth-store";

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
      navigate({ to: "/" });
    }
  }, [initialized, session, pathname, navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const result = await signIn(email.trim(), password);
    if (result.error) {
      setError("Invalid email or password");
      return;
    }
    navigate({ to: "/" });
  }

  return (
    <div className="min-h-dvh w-full grid grid-cols-1 md:grid-cols-2 bg-white">
      <div
        className="hidden md:flex flex-col justify-between p-12 text-white"
        style={{ backgroundColor: "#1B4D3E" }}
      >
        <div className="text-[28px] font-semibold tracking-tight whitespace-pre-line">{"Minted Panel\nCredentialing"}</div>
        <div className="text-[14px] text-white/70 max-w-xs">
          Credentialing operations for allied health organizations.
        </div>
      </div>

      <div className="flex items-center justify-center p-8">
        <form onSubmit={onSubmit} className="w-full max-w-sm space-y-6" noValidate>
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight text-foreground">
              Sign in
            </h1>
            <p className="mt-1 text-[14px] text-muted-foreground">
              Use your OpenPanel credentials.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
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
