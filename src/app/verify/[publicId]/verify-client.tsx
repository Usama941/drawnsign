"use client";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

type Verdict = "SIGNED_TRUSTED" | "SIGNED_DEVELOPMENT" | "SIGNATURE_INVALID" | "NOT_SIGNED";

interface FullView {
  exists: true;
  restricted: false;
  document: { publicId: string; issuer: string };
  version: { number: number; kind: string; createdAt: string };
  verdict: Verdict;
  development: boolean;
  seal: {
    mode: string;
    sealedAt: string | null;
    timestampAt: string | null;
    subject: string | null;
    checks: {
      coversWholeFile: boolean;
      digestValid: boolean;
      signatureValid: boolean;
      timestampValid: boolean;
    };
  } | null;
  signers: { name: string; signedAt: string | null }[];
  later: { latestVersion: number; latestSignedVersion: number | null };
  amendments: { count: number };
}
type View =
  { exists: boolean; restricted?: undefined } | { exists: true; restricted: true } | FullView;
type HashResult =
  | { restricted: true }
  | { match: false }
  | { match: true; versionNo: number; signed: boolean; development: boolean; thisVersion: boolean };

const KIND_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  SENT: "Sent for signature",
  SIGNED: "Signed",
  AMENDED: "Amended - not signed",
  CORRECTION: "Correction - not signed",
};

const STYLE: Record<Verdict, { bg: string; border: string; title: (v: FullView) => string }> = {
  SIGNED_TRUSTED: {
    bg: "#ecfdf5",
    border: "#059669",
    title: (v) => `Authentic signed document - version ${v.version.number}`,
  },
  SIGNED_DEVELOPMENT: {
    bg: "#fffbeb",
    border: "#d97706",
    title: (v) => `Signed version ${v.version.number} (development seal)`,
  },
  SIGNATURE_INVALID: {
    bg: "#fef2f2",
    border: "#dc2626",
    title: () => "Signature check failed - do not rely on this document",
  },
  NOT_SIGNED: {
    bg: "#f3f4f6",
    border: "#6b7280",
    title: (v) =>
      `Version ${v.version.number}: ${KIND_LABEL[v.version.kind] ?? v.version.kind}. This version is not signed.`,
  },
};

const when = (s: string | null) => (s ? new Date(s).toUTCString() : "-");
const tick = (ok: boolean) => (ok ? "Pass" : "Fail");

export function VerifyClient() {
  const { publicId } = useParams<{ publicId: string }>();
  const token = useSearchParams().get("t") ?? "";
  const [view, setView] = useState<View | null>(null);
  const [hash, setHash] = useState<{ name: string; result: HashResult } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/verify/${encodeURIComponent(publicId)}?t=${encodeURIComponent(token)}`, {
      credentials: "same-origin",
    })
      .then((r) => r.json())
      .then((v: View) => !cancelled && setView(v));
    return () => {
      cancelled = true;
    };
  }, [publicId, token]);

  async function checkFile(file: File) {
    // Hashed in the browser; the file itself never leaves this device.
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const res = await fetch(`/api/v1/verify/${encodeURIComponent(publicId)}/hash`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, sha256 }),
    });
    setHash({ name: file.name, result: (await res.json()) as HashResult });
  }

  if (!view)
    return (
      <main>
        <p>Checking…</p>
      </main>
    );

  return (
    <main className="stack" style={{ maxWidth: 760 }}>
      <h1>Verify {publicId}</h1>
      {!view.exists && <p>No document with this ID was found.</p>}
      {view.exists && view.restricted === undefined && (
        <p>
          This document exists. Scan the QR code on the document, or open its full verification
          link, to see its status.
        </p>
      )}
      {view.exists && view.restricted === true && (
        <p>
          This is a confidential internal record. Verification is restricted: sign in with an
          account that has access to it.
        </p>
      )}
      {"verdict" in view && <Result view={view} />}

      {"verdict" in view && (
        <section className="stack">
          <h2>Check a copy</h2>
          <p>
            Choose a PDF to compare with this document. It is checked on your device; only its
            fingerprint (SHA-256) is sent.
          </p>
          <input
            aria-label="PDF to check"
            type="file"
            accept="application/pdf"
            onChange={(e) => e.target.files?.[0] && void checkFile(e.target.files[0])}
          />
          {hash && <HashAnswer name={hash.name} result={hash.result} />}
        </section>
      )}
    </main>
  );
}

function Result({ view }: { view: FullView }) {
  const s = STYLE[view.verdict];
  return (
    <>
      {view.development && (
        <p className="banner" role="note">
          <strong>Development seal - not a trusted signature.</strong> This document was sealed by a
          test system. Do not rely on it.
        </p>
      )}
      <section
        role="status"
        style={{ background: s.bg, border: `2px solid ${s.border}`, borderRadius: 6, padding: 16 }}
      >
        <h2 style={{ margin: 0 }}>{s.title(view)}</h2>
        <p style={{ margin: "8px 0 0" }}>Issued by {view.document.issuer}.</p>
        {view.version.kind !== "SIGNED" && view.later.latestSignedVersion && (
          <p>A signed version exists: version {view.later.latestSignedVersion}.</p>
        )}
        {view.later.latestVersion > view.version.number && (
          <p>Later versions exist (latest: version {view.later.latestVersion}).</p>
        )}
        <p>Subsequent amendments: {view.amendments.count}</p>
      </section>
      {view.signers.length > 0 && (
        <section>
          <h2>Signers</h2>
          <ul>
            {view.signers.map((x, i) => (
              <li key={i}>
                {x.name} - signed {when(x.signedAt)}
              </li>
            ))}
          </ul>
        </section>
      )}
      {view.seal && (
        <section>
          <h2>Integrity</h2>
          <table>
            <tbody>
              <tr>
                <td>Whole file covered by the seal</td>
                <td>{tick(view.seal.checks.coversWholeFile)}</td>
              </tr>
              <tr>
                <td>Content unchanged since sealing</td>
                <td>{tick(view.seal.checks.digestValid)}</td>
              </tr>
              <tr>
                <td>Seal signature</td>
                <td>{tick(view.seal.checks.signatureValid)}</td>
              </tr>
              <tr>
                <td>Trusted timestamp</td>
                <td>
                  {tick(view.seal.checks.timestampValid)} ({when(view.seal.timestampAt)})
                </td>
              </tr>
              <tr>
                <td>Sealed by</td>
                <td>{view.seal.subject ?? "-"}</td>
              </tr>
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

function HashAnswer({ name, result }: { name: string; result: HashResult }) {
  if ("restricted" in result)
    return <p>Verification is restricted for this confidential record.</p>;
  if (!result.match) {
    return (
      <p role="alert" className="error">
        <strong>No match.</strong> {name} has been altered or is not from this platform.
      </p>
    );
  }
  if (result.signed) {
    return (
      <p role="alert">
        <strong>
          Matches signed version {result.versionNo}
          {result.development ? " (development seal)" : ""}.
        </strong>
      </p>
    );
  }
  return (
    <p role="alert">
      <strong>Matches version {result.versionNo}, which is not the signed version.</strong>
    </p>
  );
}
