// Server-only SendGrid env resolution. Never VITE_-prefixed: these values must
// not reach the browser bundle.

export interface EmailEnv {
  apiKey?: string;
  fromEmail?: string;
  fromName: string;
  sandbox: boolean;
}

function pick(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function resolveEmailEnv(): EmailEnv {
  return {
    apiKey: pick("SENDGRID_API_KEY"),
    fromEmail: pick("SENDGRID_FROM_EMAIL"),
    fromName: pick("SENDGRID_FROM_NAME") ?? "Minted Panel",
    // Fails closed: a typo or an unset var never delivers real mail.
    sandbox: pick("SENDGRID_SANDBOX") !== "false",
  };
}
