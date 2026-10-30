import { Client } from "pg";
import { inject } from "vitest";
import { Storage } from "@/storage";
import { FsObjectStore } from "@/storage/fs-store";

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

// The suite-wide storage (see global-setup.ts).
export function sharedStorage() {
  const dir = inject("storageDir");
  const evidence = new FsObjectStore(`${dir}/evidence`);
  return { evidence, storage: new Storage(new FsObjectStore(`${dir}/drafts`), evidence) };
}
