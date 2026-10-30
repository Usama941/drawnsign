"use client";
import { useParams, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { PdfPages } from "@/components/PdfPages";
import { api } from "@/lib/client/api";

type FieldType = "SIGNATURE" | "INITIALS" | "DATE" | "TEXT" | "CHECKBOX" | "DROPDOWN";

interface Field {
  key: number;
  recipient: number;
  type: FieldType;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  options?: string[];
}

const SIZES: Record<FieldType, [number, number]> = {
  SIGNATURE: [0.25, 0.06],
  INITIALS: [0.1, 0.05],
  DATE: [0.16, 0.03],
  TEXT: [0.25, 0.03],
  CHECKBOX: [0.03, 0.022],
  DROPDOWN: [0.2, 0.03],
};
const COLORS = ["#2563eb", "#dc2626", "#059669", "#7c3aed", "#d97706", "#0891b2"];
const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);

export default function PreparePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [recipients, setRecipients] = useState([{ name: "", email: "" }]);
  const [orderMode, setOrderMode] = useState<"SEQUENTIAL" | "PARALLEL">("SEQUENTIAL");
  const [active, setActive] = useState(0);
  const [type, setType] = useState<FieldType>("SIGNATURE");
  const [fields, setFields] = useState<Field[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nextKey = useRef(1);
  const drag = useRef<{
    key: number;
    dx: number;
    dy: number;
    size: { width: number; height: number };
  } | null>(null);

  function place(page: number, fx: number, fy: number) {
    const [w, h] = SIZES[type];
    setFields((fs) => [
      ...fs,
      {
        key: nextKey.current++,
        recipient: active,
        type,
        page,
        x: clamp(fx - w / 2, 1 - w),
        y: clamp(fy - h / 2, 0.95 - h),
        width: w,
        height: h,
        options: type === "DROPDOWN" ? ["Yes", "No"] : undefined,
      },
    ]);
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const env = await api<{ id: string }>("/api/v1/envelopes", {
        method: "POST",
        json: {
          documentId: id,
          orderMode,
          recipients,
          fields: fields.map((f) => ({
            recipient: f.recipient,
            type: f.type,
            page: f.page,
            x: f.x,
            y: f.y,
            width: f.width,
            height: f.height,
            options: f.options,
          })),
        },
      });
      await api(`/api/v1/envelopes/${env.id}/send`, { method: "POST" });
      router.push("/documents");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <main style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 24, maxWidth: 1100 }}>
      <aside className="stack" style={{ alignContent: "start" }}>
        <h1 style={{ fontSize: 20 }}>Prepare</h1>
        <label>
          Signing order
          <select
            value={orderMode}
            onChange={(e) => setOrderMode(e.target.value as typeof orderMode)}
          >
            <option value="SEQUENTIAL">In order</option>
            <option value="PARALLEL">Any order</option>
          </select>
        </label>
        <fieldset className="stack">
          <legend>Recipients</legend>
          {recipients.map((r, i) => (
            <div
              key={i}
              className="stack"
              style={{ borderLeft: `4px solid ${COLORS[i % COLORS.length]}`, paddingLeft: 8 }}
            >
              <label className="row">
                <input
                  type="radio"
                  name="active"
                  checked={active === i}
                  onChange={() => setActive(i)}
                />{" "}
                Place fields for
              </label>
              <input
                aria-label={`Recipient ${i + 1} name`}
                placeholder="Name"
                value={r.name}
                onChange={(e) =>
                  setRecipients((rs) =>
                    rs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                  )
                }
              />
              <input
                aria-label={`Recipient ${i + 1} email`}
                placeholder="Email"
                type="email"
                value={r.email}
                onChange={(e) =>
                  setRecipients((rs) =>
                    rs.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)),
                  )
                }
              />
            </div>
          ))}
          <button
            type="button"
            className="secondary"
            onClick={() => setRecipients((rs) => [...rs, { name: "", email: "" }])}
          >
            Add recipient
          </button>
        </fieldset>
        <label>
          Field type (click the page to place)
          <select
            aria-label="Field type"
            value={type}
            onChange={(e) => setType(e.target.value as FieldType)}
          >
            {Object.keys(SIZES).map((t) => (
              <option key={t} value={t}>
                {t.toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <p>{fields.length} field(s) placed.</p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="button" onClick={send} disabled={busy || fields.length === 0}>
          {busy ? "Sending…" : "Send for signature"}
        </button>
      </aside>
      <PdfPages
        src={`/api/v1/documents/${id}/file`}
        onPageClick={place}
        overlay={(page, size) =>
          fields
            .filter((f) => f.page === page)
            .map((f) => (
              <div
                key={f.key}
                data-field={f.type}
                onPointerDown={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  drag.current = {
                    key: f.key,
                    dx: e.clientX - r.left,
                    dy: e.clientY - r.top,
                    size,
                  };
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  const d = drag.current;
                  if (!d || d.key !== f.key) return;
                  const pageBox = e.currentTarget.parentElement!.getBoundingClientRect();
                  const x = (e.clientX - pageBox.left - d.dx) / d.size.width;
                  const y = (e.clientY - pageBox.top - d.dy) / d.size.height;
                  setFields((fs) =>
                    fs.map((g) =>
                      g.key === f.key
                        ? { ...g, x: clamp(x, 1 - g.width), y: clamp(y, 0.95 - g.height) }
                        : g,
                    ),
                  );
                }}
                onPointerUp={() => (drag.current = null)}
                style={{
                  position: "absolute",
                  left: f.x * size.width,
                  top: f.y * size.height,
                  width: f.width * size.width,
                  height: f.height * size.height,
                  border: `2px solid ${COLORS[f.recipient % COLORS.length]}`,
                  background: `${COLORS[f.recipient % COLORS.length]}22`,
                  fontSize: 11,
                  cursor: "move",
                  overflow: "hidden",
                }}
              >
                {f.type.toLowerCase()} · {recipients[f.recipient]?.name || `#${f.recipient + 1}`}
                <button
                  type="button"
                  aria-label="Remove field"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setFields((fs) => fs.filter((g) => g.key !== f.key))}
                  style={{ position: "absolute", top: 0, right: 0, padding: "0 4px", fontSize: 11 }}
                >
                  ×
                </button>
              </div>
            ))
        }
      />
    </main>
  );
}
