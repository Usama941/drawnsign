import { Client } from "pg";
import { inject } from "vitest";

export async function connect(which: "admin" | "app"): Promise<Client> {
  const client = new Client({
    connectionString: inject(which === "admin" ? "adminUrl" : "appUrl"),
  });
  await client.connect();
  return client;
}

export async function existingTables(client: Client, names: readonly string[]): Promise<string[]> {
  const { rows } = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1)`,
    [names],
  );
  return rows.map((r) => r.table_name);
}
