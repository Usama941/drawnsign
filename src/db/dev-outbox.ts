import { desc } from "drizzle-orm";
import { getDb } from "./client";
import { devOutbox } from "./schema";

export async function storeOutboxMail(m: {
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  await getDb().insert(devOutbox).values(m);
}

export async function latestOutboxMail(limit = 50) {
  return getDb().select().from(devOutbox).orderBy(desc(devOutbox.createdAt)).limit(limit);
}
