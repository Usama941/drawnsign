import type { AddressInfo } from "node:net";
import { SMTPServer } from "smtp-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SmtpMailer } from "./index";

// Stands in for Mailpit: a local SMTP server that captures messages.
describe("SmtpMailer", () => {
  const received: string[] = [];
  let server: SMTPServer;
  let port: number;

  beforeAll(async () => {
    server = new SMTPServer({
      authOptional: true,
      disabledCommands: ["STARTTLS"],
      onData(stream, _session, callback) {
        let data = "";
        stream.on("data", (chunk: Buffer) => (data += chunk.toString()));
        stream.on("end", () => {
          received.push(data);
          callback();
        });
      },
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("delivers to a local catcher", async () => {
    const mailer = new SmtpMailer(`smtp://127.0.0.1:${port}`, "drawnsign <dev@localhost>");
    await mailer.send({ to: "signer@example.test", subject: "Your code", text: "123456" });
    expect(received).toHaveLength(1);
    expect(received[0]).toContain("Subject: Your code");
    expect(received[0]).toContain("123456");
  });
});
