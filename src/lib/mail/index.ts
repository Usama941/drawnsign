import nodemailer, { type Transporter } from "nodemailer";
import { outboxEnabled } from "@/lib/preview";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

// Test and local-development mailer. Keeps messages in memory and never logs their bodies,
// which carry single-use tokens.
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}

export class PostmarkMailer implements Mailer {
  constructor(
    private readonly serverToken: string,
    private readonly from: string,
  ) {}

  async send(message: MailMessage): Promise<void> {
    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": this.serverToken,
      },
      body: JSON.stringify({
        From: this.from,
        To: message.to,
        Subject: message.subject,
        TextBody: message.text,
        MessageStream: "outbound",
      }),
    });
    if (!res.ok) throw new Error(`Postmark send failed with status ${res.status}`);
  }
}

// Development: sends to a local catcher such as Mailpit (SMTP_URL=smtp://localhost:1025),
// so OTP, invite and signing emails can be read at http://localhost:8025 without Postmark.
export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(
    url: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(url);
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}

// Preview-only (EMAIL_MODE=outbox): stores emails for the /dev/outbox page.
export class OutboxMailer implements Mailer {
  async send(message: MailMessage): Promise<void> {
    const { storeOutboxMail } = await import("@/db/dev-outbox");
    await storeOutboxMail(message);
  }
}

let mailer: Mailer | undefined;

export function getMailer(): Mailer {
  if (!mailer) {
    const token = process.env.POSTMARK_SERVER_TOKEN;
    const from = process.env.MAIL_FROM;
    const smtp = process.env.SMTP_URL;
    if (outboxEnabled()) {
      mailer = new OutboxMailer();
    } else if (token && from) {
      mailer = new PostmarkMailer(token, from);
    } else if (smtp && process.env.VERCEL_ENV !== "production") {
      mailer = new SmtpMailer(smtp, from ?? "drawnsign <dev@localhost>");
    } else if (process.env.NODE_ENV === "production") {
      throw new Error("POSTMARK_SERVER_TOKEN and MAIL_FROM must be set in production");
    } else {
      mailer = new MemoryMailer();
    }
  }
  return mailer;
}

export function setMailerForTests(m: Mailer): void {
  mailer = m;
}
