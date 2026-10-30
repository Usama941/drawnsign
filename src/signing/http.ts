import { getMailer, type MailMessage } from "@/lib/mail";
import { problem } from "@/server/problem";
import { EnvelopeError } from "./envelopes";

export function sendAll(mail: MailMessage[]): () => Promise<void> {
  return async () => {
    const mailer = getMailer();
    for (const m of mail) await mailer.send(m);
  };
}

export async function envelopeErrors(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof EnvelopeError)
      return problem(err.status, err.status === 404 ? "Not Found" : "Conflict", err.message);
    throw err;
  }
}
