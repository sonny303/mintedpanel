import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/login')({
  component: LoginPage,
});

function LoginPage() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8">
        <h1 className="text-[20px] font-semibold tracking-tight text-foreground">Sign in</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">OpenPanel — Login</p>
      </div>
    </div>
  );
}
