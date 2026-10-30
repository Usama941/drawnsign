# Database roles

| Role | Login | Used by | Privileges |
| --- | --- | --- | --- |
| Migrator (schema owner) | yes | `pnpm db:migrate` via `DATABASE_URL_MIGRATOR` | Owns all tables, functions and policies |
| `app_role` | no | Granted to the app's login role | `SELECT, INSERT` by default; `UPDATE, DELETE` only where a migration grants it; never on evidence tables; subject to RLS |
| App login role | yes | The Next.js app via `DATABASE_URL` | Member of `app_role` only |

Create the app login role once per environment (Neon: SQL editor, as the owner role):

```sql
CREATE ROLE app_user LOGIN PASSWORD '<generated, stored in the secret manager>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS IN ROLE app_role;
```

Never put the password in code, logs or test fixtures. Never grant the app login role
ownership of any table: table owners bypass RLS unless the table has `FORCE ROW LEVEL SECURITY`.
