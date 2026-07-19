// E4.4 F4.4.3 — Admin Click-to-Reveal. Admin-only (the RPC re-checks
// server-side). A typed justification is required; the full value is shown for a
// short fixed window then auto-rehides. The plaintext lives ONLY in this
// component's local state for the window and is never persisted, cached, or
// logged (reveal is a mutation, not a cached query).
import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRevealSsn } from "@/hooks/useSsnVault";
import { formatFullSsn } from "@/lib/ssnMask";

const REVEAL_WINDOW_SECONDS = 20;

export function SsnRevealDialog({
  providerId,
  providerName,
  open,
  onOpenChange,
}: {
  providerId: string;
  providerName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const reveal = useRevealSsn(providerId);
  const [justification, setJustification] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function clearTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  // Auto-rehide countdown. When the window elapses, drop the value from memory.
  useEffect(() => {
    if (revealed === null) return;
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearTimer();
          setRevealed(null);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return clearTimer;
  }, [revealed]);

  // Reset everything whenever the dialog closes — the value never survives it.
  useEffect(() => {
    if (!open) {
      clearTimer();
      setRevealed(null);
      setSecondsLeft(0);
      setJustification("");
      reveal.reset();
    }
    // reveal.reset is stable; excluding it keeps this to the open transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const trimmed = justification.trim();
  async function onReveal() {
    if (!trimmed) return;
    try {
      const res = await reveal.mutateAsync(trimmed);
      setRevealed(res.ssn);
      setSecondsLeft(REVEAL_WINDOW_SECONDS);
    } catch {
      // The error surfaces via reveal.error below; nothing to log (never the value).
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reveal full SSN</DialogTitle>
          <DialogDescription>
            Revealing {providerName}'s full SSN is recorded in the audit log with your name, the
            time, and your justification. It hides automatically after a few seconds.
          </DialogDescription>
        </DialogHeader>

        {revealed === null ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ssn-reveal-justification">Justification</Label>
              <Textarea
                id="ssn-reveal-justification"
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                placeholder="Why does this SSN need to be viewed right now?"
                rows={3}
                autoFocus
              />
            </div>
            {reveal.error ? (
              <div
                role="alert"
                className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-[12px] text-[#B91C1C]"
              >
                {(reveal.error as Error).message}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-2">
            <div
              className="rounded-md border border-[#FDE68A] bg-[#FEF3C7] px-3 py-3 text-center font-mono text-[18px] tracking-widest text-[#92400E]"
              aria-live="polite"
            >
              {formatFullSsn(revealed)}
            </div>
            <p className="text-center text-[12px] text-muted-foreground" aria-live="polite">
              Hiding in {secondsLeft}s
            </p>
          </div>
        )}

        <DialogFooter>
          {revealed === null ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={onReveal}
                disabled={!trimmed || reveal.isPending}
                className="bg-[#1B4D3E] text-white hover:bg-[#163F33]"
              >
                {reveal.isPending ? "Revealing…" : "Reveal"}
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={() => {
                clearTimer();
                setRevealed(null);
                setSecondsLeft(0);
              }}
            >
              Hide now
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
