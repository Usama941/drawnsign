import { PDFDocument } from "@cantoo/pdf-lib";
import { expect } from "vitest";
import { mailer } from "./auth-helpers";
import { call } from "./http";

export const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

export const r = {
  documents: import("@/app/api/v1/documents/route"),
  content: import("@/app/api/v1/uploads/[id]/content/route"),
  complete: import("@/app/api/v1/uploads/[id]/complete/route"),
  envelopes: import("@/app/api/v1/envelopes/route"),
  envelope: import("@/app/api/v1/envelopes/[id]/route"),
  send: import("@/app/api/v1/envelopes/[id]/send/route"),
  void: import("@/app/api/v1/envelopes/[id]/void/route"),
  view: import("@/app/api/v1/sign/[token]/route"),
  consent: import("@/app/api/v1/sign/[token]/consent/route"),
  otp: import("@/app/api/v1/sign/[token]/otp/route"),
  verify: import("@/app/api/v1/sign/[token]/otp/verify/route"),
  doc: import("@/app/api/v1/sign/[token]/document/route"),
  sign: import("@/app/api/v1/sign/[token]/complete/route"),
  decline: import("@/app/api/v1/sign/[token]/decline/route"),
};

export function lastLinkTo(email: string): string {
  const m = mailer.sent.findLast((x) => x.to === email && /\/sign\//.test(x.text));
  if (!m) throw new Error(`no signing link for ${email}`);
  return /\/sign\/([A-Za-z0-9_-]{22})/.exec(m.text)![1]!;
}

export function linksTo(email: string): number {
  return mailer.sent.filter((x) => x.to === email && /\/sign\//.test(x.text)).length;
}

// Consent, request a code, read it from the email, verify it: returns cookie headers.
export async function signerSession(token: string, email: string): Promise<Headers> {
  const p = { token };
  expect((await call(r.consent, "POST", { params: p })).status).toBe(200);
  expect((await call(r.otp, "POST", { params: p })).status).toBe(202);
  const code = /code is (\d{6})/.exec(mailer.sent.findLast((x) => x.to === email)!.text)![1]!;
  const res = await call(r.verify, "POST", { params: p, json: { code } });
  expect(res.status).toBe(200);
  return new Headers({ cookie: res.headers.get("set-cookie")!.split(";")[0]! });
}

export async function signAll(token: string, email: string) {
  const headers = await signerSession(token, email);
  const view = await (await call(r.view, "GET", { params: { token }, headers })).json();
  const values = view.fields.map((f: { id: string; type: string }) => ({
    fieldId: f.id,
    value:
      f.type === "SIGNATURE"
        ? PNG
        : f.type === "DATE"
          ? "2026-10-30"
          : f.type === "CHECKBOX"
            ? "true"
            : "Ada",
  }));
  return call(r.sign, "POST", { params: { token }, headers, json: { values } });
}

export async function draftDocument(
  headers: Headers,
  pages = 2,
  title = "Agreement",
): Promise<string> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pages; i++) pdf.addPage([600, 800]);
  const created = await (await call(r.documents, "POST", { headers, json: { title } })).json();
  const u = { id: created.upload.id };
  await call(r.content, "PUT", { headers, params: u, body: await pdf.save() });
  await call(r.complete, "POST", { headers, params: u });
  return created.documentId;
}

export async function sendEnvelope(
  headers: Headers,
  emails: string[],
  orderMode: "SEQUENTIAL" | "PARALLEL",
): Promise<{ id: string; documentId: string }> {
  const documentId = await draftDocument(headers);
  const res = await call(r.envelopes, "POST", {
    headers,
    json: {
      documentId,
      orderMode,
      recipients: emails.map((email, i) => ({ name: `Signer ${i + 1}`, email })),
      fields: emails.flatMap((_, i) => [
        {
          recipient: i,
          type: "SIGNATURE",
          page: 1,
          x: 0.1,
          y: 0.1 + i * 0.2,
          width: 0.3,
          height: 0.08,
        },
        { recipient: i, type: "DATE", page: 2, x: 0.5, y: 0.1 + i * 0.2, width: 0.2, height: 0.04 },
      ]),
    },
  });
  expect(res.status).toBe(201);
  const { id } = await res.json();
  expect((await call(r.send, "POST", { headers, params: { id } })).status).toBe(200);
  return { id, documentId };
}
