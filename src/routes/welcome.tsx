// Landing page for invited users after they click the email link.
// They arrive with a valid session but no password. We collect one,
// then run claim_invites() to attach any pending memberships.
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/externalClient';
import { useAuthStore } from '@/lib/auth-store';

export const Route = createFileRoute('/welcome')({
  component: WelcomePage,
});

function WelcomePage() {
  const navigate = useNavigate();
  const session = useAuthStore((s) => s.session);
  const initialized = useAuthStore((s) => s.initialized);
  const loadMemberships = useAuthStore((s) => s.loadMemberships);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialized && !session) {
      navigate({ to: '/login' });
    }
  }, [initialized, session, navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const { error: pwError } = await supabase.auth.updateUser({ password });
      if (pwError) throw pwError;
      const rpc = supabase.rpc as unknown as (name: string) => Promise<{
        data: number | null;
        error: { message: string } | null;
      }>;
      const { error: claimError } = await rpc('claim_invites');
      if (claimError) throw claimError;
      await loadMemberships();
      navigate({ to: '/cases' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set password');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-dvh w-full grid grid-cols-1 md:grid-cols-2 bg-white">
      <div
        className="hidden md:flex flex-col justify-between p-12 text-white"
        style={{ backgroundColor: '#1B4D3E' }}
      >
        <div className="text-[28px] font-semibold tracking-tight whitespace-pre-line">
          {'Minted Panel\nCredentialing'}
        </div>
        <div className="text-[14px] text-white/70 max-w-xs">
          Welcome to the team. Set a password to finish setting up your account.
        </div>
      </div>

      <div className="flex items-center justify-center p-8">
        <form onSubmit={onSubmit} className="w-full max-w-sm space-y-6" noValidate>
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight text-foreground">
              Set your password
            </h1>
            <p className="mt-1 text-[14px] text-muted-foreground">
              Choose a password (at least 8 characters) to activate your Minted Panel account.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="welcome-password">New password</Label>
            <Input
              id="welcome-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="welcome-confirm">Confirm password</Label>
            <Input
              id="welcome-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={8}
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

          <Button
            type="submit"
            disabled={submitting}
            className="w-full text-white hover:opacity-90"
            style={{ backgroundColor: '#1B4D3E' }}
          >
            {submitting ? 'Setting password…' : 'Set password and continue'}
          </Button>
        </form>
      </div>
    </div>
  );
}
