"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/states";
import { createClient } from "@/lib/supabase/client";

type Mode = "password" | "magic-link";

export function LoginForm({ appUrl }: { appUrl: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const db = createClient();

      if (mode === "magic-link") {
        const { error: otpError } = await db.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: `${appUrl}/auth/callback`,
            // Nobody signs themselves up: accounts are created by an admin
            // invitation, so an unknown address must not silently become one.
            shouldCreateUser: false,
          },
        });
        if (otpError) throw otpError;
        setSent(true);
        return;
      }

      const { error: signInError } = await db.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;

      // The server decides where this person belongs; "/" resolves the role.
      router.replace("/");
      router.refresh();
    } catch (err) {
      // Auth errors are shown as written by Supabase only when they are safe
      // and useful ("Invalid login credentials"); anything else is generalised.
      const message = err instanceof Error ? err.message : "Sign-in failed.";
      setError(
        /invalid login credentials/i.test(message)
          ? "That email and password do not match an account."
          : /email not confirmed/i.test(message)
            ? "Your account has not been confirmed yet. Check your email for the invitation."
            : message,
      );
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-[14px] border border-success/25 bg-success-wash px-5 py-6">
        <p className="font-display text-lg font-semibold text-ink">Check your email</p>
        <p className="mt-2 text-sm text-ink-700">
          If <strong>{email}</strong> belongs to an Own Your Study account, a sign-in link is on its
          way. It expires shortly, so use it soon.
        </p>
        <button
          type="button"
          onClick={() => setSent(false)}
          className="mt-4 text-sm font-semibold text-accent hover:underline"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {error ? <ErrorState title="Could not sign you in" description={error} /> : null}

      <div>
        <label htmlFor="email" className="field-label">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="field"
          placeholder="you@example.com"
        />
      </div>

      {mode === "password" ? (
        <div>
          <label htmlFor="password" className="field-label">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field"
          />
        </div>
      ) : null}

      <Button type="submit" variant="solid" disabled={busy} className="w-full">
        {busy ? "One moment…" : mode === "password" ? "Log in" : "Email me a sign-in link"}
      </Button>

      <button
        type="button"
        onClick={() => {
          setMode(mode === "password" ? "magic-link" : "password");
          setError(null);
        }}
        className="w-full text-center text-sm font-medium text-ink-500 hover:text-accent hover:underline"
      >
        {mode === "password" ? "Email me a sign-in link instead" : "Use a password instead"}
      </button>
    </form>
  );
}
