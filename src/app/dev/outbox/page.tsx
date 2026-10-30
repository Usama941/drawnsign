"use client";
import { useState } from "react";

interface Mail {
  id: string;
  to: string;
  subject: string;
  text: string;
  createdAt: string;
}

// Preview-only inbox for every email the app sent (EMAIL_MODE=outbox).
export default function OutboxPage() {
  const [key, setKey] = useState("");
  const [mail, setMail] = useState<Mail[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    const res = await fetch("/api/dev/outbox", {
      headers: { "x-outbox-key": key },
      cache: "no-store",
    });
    if (res.status === 404)
      return setError("The preview outbox is not enabled on this deployment.");
    if (!res.ok) return setError("Wrong passphrase.");
    setMail(((await res.json()) as { mail: Mail[] }).mail);
  }

  const linkify = (text: string) =>
    text.split(/(https?:\/\/\S+)/g).map((part, i) =>
      /^https?:\/\//.test(part) ? (
        <a key={i} href={part}>
          {part}
        </a>
      ) : (
        <span key={i}>{part}</span>
      ),
    );

  return (
    <main className="stack">
      <h1>Preview outbox</h1>
      <p className="banner">
        Test deployments only. Emails are stored here instead of being delivered.
      </p>
      <form className="row" onSubmit={load}>
        <input
          aria-label="Outbox passphrase"
          type="password"
          placeholder="DEV_OUTBOX_KEY"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <button type="submit">{mail ? "Refresh" : "Open"}</button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {mail?.length === 0 && <p>No emails yet.</p>}
      {mail?.map((m) => (
        <article
          key={m.id}
          style={{
            border: "1px solid var(--line)",
            borderRadius: 4,
            padding: 12,
            background: "#fff",
          }}
        >
          <p style={{ margin: 0 }}>
            <strong>{m.subject}</strong>
          </p>
          <p style={{ margin: 0, color: "var(--muted)" }}>
            To {m.to} · {new Date(m.createdAt).toLocaleString()}
          </p>
          <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{linkify(m.text)}</pre>
        </article>
      ))}
    </main>
  );
}
