"use client";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PdfPages } from "@/components/PdfPages";
import { SignaturePad } from "@/components/SignaturePad";
import { api } from "@/lib/client/api";

interface SignField {
  id: string;
  type: "SIGNATURE" | "INITIALS" | "DATE" | "TEXT" | "CHECKBOX" | "DROPDOWN";
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  required: boolean;
  options: string[] | null;
}

interface View {
  document: { title: string; publicId: string; pageCount: number };
  recipient: { name: string; email: string };
  consentText: string;
  consented: boolean;
  verified: boolean;
  fields: SignField[];
}

export default function SignPage() {
  const { token } = useParams<{ token: string }>();
  const base = `/api/v1/sign/${token}`;
  const [view, setView] = useState<View | null>(null);
  const [gone, setGone] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [initials, setInitials] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");

  const [reload, setReload] = useState(0);
  const load = async () => setReload((n) => n + 1);
  useEffect(() => {
    let cancelled = false;
    fetch(base, { credentials: "same-origin" }).then(async (res) => {
      if (cancelled) return;
      if (res.status === 404) return setGone(true);
      const v = (await res.json()) as View;
      if (cancelled) return;
      setView(v);
      const today = new Date().toISOString().slice(0, 10);
      setValues(
        Object.fromEntries(v.fields.filter((f) => f.type === "DATE").map((f) => [f.id, today])),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [base, reload]);

  const act = (fn: () => Promise<unknown>) => async () => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (done)
    return (
      <main>
        <h1>{done}</h1>
        <p>You can close this page.</p>
      </main>
    );
  if (gone)
    return (
      <main>
        <h1>This signing link is no longer valid</h1>
        <p>It may have expired, or the document was already signed, declined or withdrawn.</p>
      </main>
    );
  if (!view)
    return (
      <main>
        <p>Loading…</p>
      </main>
    );

  const complete = act(async () => {
    const payload = view.fields.map((f) => ({
      fieldId: f.id,
      value:
        f.type === "SIGNATURE"
          ? (signature ?? "")
          : f.type === "INITIALS"
            ? (initials ?? "")
            : (values[f.id] ?? (f.type === "CHECKBOX" ? "false" : "")),
    }));
    await api(`${base}/complete`, { method: "POST", json: { values: payload } });
    setDone("Thank you, you have signed");
  });

  return (
    <main className="stack">
      <h1>{view.document.title}</h1>
      <p>
        Hello {view.recipient.name}. Document <code>{view.document.publicId}</code>.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {!view.consented && (
        <section className="stack" style={{ maxWidth: 560 }}>
          <h2>Electronic records consent</h2>
          <p>{view.consentText}</p>
          <label className="row">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I
            agree
          </label>
          <button
            type="button"
            disabled={!agree}
            onClick={act(async () => {
              await api(`${base}/consent`, { method: "POST" });
              await load();
            })}
          >
            Continue
          </button>
        </section>
      )}

      {view.consented && !view.verified && (
        <section className="stack" style={{ maxWidth: 400 }}>
          <h2>Confirm it is you</h2>
          <p>We will email a 6-digit code to {view.recipient.email}.</p>
          <button
            type="button"
            className={codeSent ? "secondary" : undefined}
            onClick={act(async () => {
              await api(`${base}/otp`, { method: "POST" });
              setCodeSent(true);
            })}
          >
            {codeSent ? "Send a new code" : "Email me a code"}
          </button>
          {codeSent && (
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () => {
                  await api(`${base}/otp/verify`, { method: "POST", json: { code } });
                  await load();
                })();
              }}
            >
              <input
                aria-label="Code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <button type="submit">Verify</button>
            </form>
          )}
        </section>
      )}

      {view.verified && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 24 }}>
          <PdfPages
            src={`${base}/document`}
            overlay={(page, size) =>
              view.fields
                .filter((f) => f.page === page)
                .map((f) => {
                  const style = {
                    position: "absolute" as const,
                    left: f.x * size.width,
                    top: f.y * size.height,
                    width: f.width * size.width,
                    height: f.height * size.height,
                  };
                  if (f.type === "SIGNATURE" || f.type === "INITIALS") {
                    const img = f.type === "SIGNATURE" ? signature : initials;
                    return (
                      <div
                        key={f.id}
                        style={{
                          ...style,
                          border: "2px dashed #2563eb",
                          background: "#2563eb11",
                          display: "grid",
                          placeItems: "center",
                          fontSize: 11,
                        }}
                      >
                        {img ? (
                          // eslint-disable-next-line @next/next/no-img-element -- a local data URL
                          <img alt="" src={img} style={{ maxWidth: "100%", maxHeight: "100%" }} />
                        ) : (
                          f.type.toLowerCase()
                        )}
                      </div>
                    );
                  }
                  if (f.type === "CHECKBOX") {
                    return (
                      <input
                        key={f.id}
                        aria-label="Checkbox field"
                        type="checkbox"
                        style={style}
                        checked={values[f.id] === "true"}
                        onChange={(e) =>
                          setValues((v) => ({ ...v, [f.id]: String(e.target.checked) }))
                        }
                      />
                    );
                  }
                  if (f.type === "DROPDOWN") {
                    return (
                      <select
                        key={f.id}
                        aria-label="Choice field"
                        style={{ ...style, padding: 0 }}
                        value={values[f.id] ?? ""}
                        onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                      >
                        <option value="" />
                        {f.options?.map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                    );
                  }
                  return (
                    <input
                      key={f.id}
                      aria-label={f.type === "DATE" ? "Date field" : "Text field"}
                      type={f.type === "DATE" ? "date" : "text"}
                      style={{ ...style, padding: "0 2px", fontSize: 12 }}
                      value={values[f.id] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                    />
                  );
                })
            }
          />
          <aside className="stack" style={{ alignContent: "start" }}>
            <h2>Sign</h2>
            {view.fields.some((f) => f.type === "SIGNATURE") && (
              <SignaturePad label="Signature pad" onChange={setSignature} />
            )}
            {view.fields.some((f) => f.type === "INITIALS") && (
              <SignaturePad label="Initials pad" onChange={setInitials} />
            )}
            <button
              type="button"
              onClick={complete}
              disabled={!signature && view.fields.some((f) => f.type === "SIGNATURE")}
            >
              Finish and sign
            </button>
            <button type="button" className="secondary" onClick={() => setDeclining((d) => !d)}>
              Decline to sign
            </button>
            {declining && (
              <div className="stack">
                <label>
                  Reason
                  <textarea value={reason} onChange={(e) => setReason(e.target.value)} />
                </label>
                <button
                  type="button"
                  disabled={!reason.trim()}
                  onClick={act(async () => {
                    await api(`${base}/decline`, { method: "POST", json: { reason } });
                    setDone("You declined to sign");
                  })}
                >
                  Confirm decline
                </button>
              </div>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
