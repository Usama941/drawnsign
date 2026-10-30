import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Preview-only email outbox (EMAIL_MODE=outbox, never on Vercel production): lets a tester
// read sign-up, signing-link and code emails without an email provider. Global, test data only.
export const devOutbox = pgTable("dev_outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  to: text("to").notNull(),
  subject: text("subject").notNull(),
  text: text("text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
