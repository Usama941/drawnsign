"use client";
import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/client/auth";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await authClient.signUp.email({ name, email, password, callbackURL: "/login" });
    if (res.error) return setError(res.error.message ?? "Sign-up failed");
    setSent(true);
  }

  if (sent) {
    return (
      <main className="stack" style={{ maxWidth: 480 }}>
        <h1>Check your email</h1>
        <p>
          We sent a link to {email}. Open it to confirm your address, then{" "}
          <Link href="/login">sign in</Link>.
        </p>
        <p>
          On a preview deployment without an email service, read it in the{" "}
          <Link href="/dev/outbox">preview outbox</Link>.
        </p>
      </main>
    );
  }
  return (
    <main>
      <h1>Create an account</h1>
      <form className="stack" style={{ maxWidth: 360 }} onSubmit={submit}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Password (at least 12 characters)
          <input
            type="password"
            autoComplete="new-password"
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit">Create account</button>
        <p>
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </form>
    </main>
  );
}
