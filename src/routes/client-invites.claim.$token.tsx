// E6.12 explicit claim entrypoint. The recipient must already have a verified
// Auth account; this route never creates an account or sends an email.
import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Clock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ClientAccessApiError, claimClientInvite } from "@/lib/clientAccessApi";
import { useAuthStore } from "@/lib/auth-store";

export const Route = createFileRoute("/client-invites/claim/$token")({
  component: ClientInviteClaimPage,
});

function Shell({ children }: { children: React.ReactNode }) {
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
          Powered by Minted Panel · Secure client access
        </div>
      </div>
    </div>
  );
}

interface ClaimAttempt {
  key: string;
  promise: Promise<void>;
  subscribers: number;
}

function ClientInviteClaimPage() {
  const { token } = Route.useParams();
  const session = useAuthStore((state) => state.session);
  const initialized = useAuthStore((state) => state.initialized);
  const [state, setState] = useState<"loading" | "success" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const currentAttemptRef = useRef<ClaimAttempt | null>(null);

  useEffect(() => {
    if (!initialized || !session) {
      currentAttemptRef.current = null;
      return;
    }
    const attemptKey = `${session.user.id}:${token}:${retryNonce}`;
    let cancelled = false;
    setState("loading");
    setError(null);
    let attempt = currentAttemptRef.current;
    if (!attempt || attempt.key !== attemptKey) {
      attempt = {
        key: attemptKey,
        promise: claimClientInvite(token).then(() => undefined),
        subscribers: 0,
      };
      currentAttemptRef.current = attempt;
    }
    attempt.subscribers += 1;
    void attempt.promise
      .then(() => {
        if (
          !cancelled &&
          currentAttemptRef.current === attempt &&
          currentAttemptRef.current.key === attemptKey
        ) {
          setState("success");
        }
      })
      .catch((claimError: unknown) => {
        if (
          cancelled ||
          currentAttemptRef.current !== attempt ||
          currentAttemptRef.current.key !== attemptKey
        )
          return;
        setState("error");
        setError(
          claimError instanceof ClientAccessApiError && claimError.status === 409
            ? "This access link is no longer valid."
            : "We couldn't claim this access link. Try again or contact your Minted Panel administrator.",
        );
      });
    return () => {
      cancelled = true;
      attempt.subscribers -= 1;
      // React StrictMode immediately re-runs effects after cleanup. Deferring
      // disposal by one microtask preserves that replay's current promise,
      // while a real unmount leaves no subscriber and discards the attempt.
      queueMicrotask(() => {
        if (attempt?.subscribers === 0 && currentAttemptRef.current === attempt) {
          currentAttemptRef.current = null;
        }
      });
    };
  }, [initialized, retryNonce, session, token]);

  if (!initialized) {
    return (
      <Shell>
        <Card>
          <CardContent className="flex items-center gap-3 p-8 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" /> Loading secure access…
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (!session) {
    return (
      <Shell>
        <Card>
          <CardContent className="space-y-4 p-8">
            <h1 className="text-[18px] font-semibold text-foreground">Sign in to claim access</h1>
            <p className="text-[13px] leading-5 text-muted-foreground">
              Use the existing verified Minted Panel account for the invited email. This link will
              remain attached to your sign-in.
            </p>
            <Button asChild>
              <a href={`/login?invite=${encodeURIComponent(token)}`}>Sign in</a>
            </Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (state === "loading") {
    return (
      <Shell>
        <Card>
          <CardContent className="flex items-center gap-3 p-8 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" /> Checking this access link…
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (state === "success") {
    return (
      <Shell>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <CheckCircle2 className="h-7 w-7 text-[#1B4D3E]" />
            <h1 className="text-[18px] font-semibold text-foreground">Access link claimed</h1>
            <p className="text-[13px] text-muted-foreground">
              Your assigned provider groups are ready in Minted Panel.
            </p>
            <Button asChild>
              <a href="/">Continue</a>
            </Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <Card>
        <CardContent className="flex flex-col gap-4 p-8">
          <h1 className="text-[18px] font-semibold text-foreground">Unable to claim access</h1>
          <p role="alert" className="text-[13px] leading-5 text-muted-foreground">
            {error}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={() => {
                setState("loading");
                setRetryNonce((nonce) => nonce + 1);
              }}
            >
              Try again
            </Button>
            <Button asChild variant="outline">
              <a href="/">Return home</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </Shell>
  );
}
