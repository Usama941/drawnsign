"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/client/auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (needsCode) {
      const res = await authClient.twoFactor.verifyTotp({ code });
      if (res.error) return setError(res.error.message ?? "Incorrect code");
      return router.push("/documents");
    }
    const res = await authClient.signIn.email({ email, password });
    if (res.error) return setError(res.error.message ?? "Sign-in failed");
    if (res.data && "twoFactorRedirect" in res.data && res.data.twoFactorRedirect)
      return setNeedsCode(true);
    router.push("/documents");
  }

  return (
    <main>
      <h1>Sign in</h1>
      <form className="stack" style={{ maxWidth: 360 }} onSubmit={submit}>
        {needsCode ? (
          <label>
            Authenticator code
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
        ) : (
          <>
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
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit">{needsCode ? "Verify" : "Sign in"}</button>
      </form>
    </main>
  );
}
