"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";

interface Doc {
  id: string;
  publicId: string;
  title: string;
  status: string;
}

type UploadInfo = { id: string; mode: "direct" } | { id: string; mode: "blob"; pathname: string };

async function sendBytes(upload: UploadInfo, file: File) {
  if (upload.mode === "blob") {
    const { upload: blobUpload } = await import("@vercel/blob/client");
    await blobUpload(upload.pathname, file, {
      access: "private",
      handleUploadUrl: "/api/v1/uploads/token",
      clientPayload: upload.id,
      contentType: "application/pdf",
    });
  } else {
    await api(`/api/v1/uploads/${upload.id}/content`, {
      method: "PUT",
      body: file,
      headers: { "content-type": "application/pdf" },
    });
  }
  await api(`/api/v1/uploads/${upload.id}/complete`, { method: "POST" });
  for (let i = 0; i < 60; i++) {
    const s = await api<{ status: string; rejectReason: string | null }>(
      `/api/v1/uploads/${upload.id}`,
    );
    if (s.status === "ACCEPTED") return;
    if (s.status === "REJECTED") throw new Error(`The PDF was rejected (${s.rejectReason}).`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Processing is taking longer than expected; refresh in a minute.");
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    api<{ documents: Doc[] }>("/api/v1/documents").then(
      (r) => !cancelled && setDocs(r.documents),
      (e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [reload]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api<{ upload: UploadInfo }>("/api/v1/documents", {
        method: "POST",
        json: { title },
      });
      await sendBytes(created.upload, file);
      setTitle("");
      setFile(null);
      setReload((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="stack">
      <h1>Documents</h1>
      <form className="row" onSubmit={create}>
        <input
          aria-label="Title"
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <input
          aria-label="PDF file"
          type="file"
          accept="application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          required
        />
        <button type="submit" disabled={busy}>
          {busy ? "Uploading…" : "Upload"}
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <table>
        <thead>
          <tr>
            <th align="left">Title</th>
            <th align="left">ID</th>
            <th align="left">Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id}>
              <td>{d.title}</td>
              <td>
                <code>{d.publicId}</code>
              </td>
              <td>{d.status}</td>
              <td>
                {d.status === "DRAFT" && (
                  <Link href={`/documents/${d.id}/prepare`}>Prepare and send</Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
