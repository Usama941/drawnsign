import type { AddressInfo } from "node:net";
import { SMTPServer } from "smtp-server";

export interface CapturedMail {
  to: string;
  raw: string;
}

// A local SMTP catcher (stands in for Mailpit) the app server sends to.
export async function startSmtpCapture() {
  const mails: CapturedMail[] = [];
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS"],
    onData(stream, session, callback) {
      let raw = "";
      stream.on("data", (c: Buffer) => (raw += c.toString()));
      stream.on("end", () => {
        // Undo quoted-printable soft line breaks so links and codes are on one line.
        raw = raw.replace(/=\r?\n/g, "").replace(/=3D/g, "=");
        for (const rcpt of session.envelope.rcptTo) mails.push({ to: rcpt.address, raw });
        callback();
      });
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.server.address() as AddressInfo).port;

  async function waitFor(to: string, pattern: RegExp, after = 0): Promise<RegExpExecArray> {
    for (let i = 0; i < 100; i++) {
      for (const m of mails.slice(after).reverse()) {
        const match = m.to === to ? pattern.exec(m.raw) : null;
        if (match) return match;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`no email to ${to} matching ${pattern}`);
  }

  return {
    url: `smtp://127.0.0.1:${port}`,
    mails,
    waitFor,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
