# Local development

## Database

Any Postgres 16. Create a database, then:

```bash
DATABASE_URL_MIGRATOR=postgres://... pnpm db:migrate
```

Create the app login role as in `database-roles.md` and set `DATABASE_URL` to it.

## Email (Mailpit)

No Postmark account is needed in development. Run the Mailpit catcher:

```bash
docker run --rm -p 1025:1025 -p 8025:8025 axllent/mailpit
```

Set `SMTP_URL=smtp://localhost:1025` (and optionally `MAIL_FROM`). Every verification, OTP,
invite and signing email lands in the inbox at http://localhost:8025. Without `SMTP_URL` the
app keeps emails in memory and does not print their contents (they carry tokens).

Vercel preview deployments cannot reach a local catcher, so emails there are not delivered
until Postmark is configured.

## Uploads

Leave `UPLOAD_MODE` unset locally: the browser posts the PDF to the API. On Vercel set
`UPLOAD_MODE=blob` and a Blob token, so browsers upload straight to Vercel Blob.

## Background jobs

Without `INNGEST_DEV` or `INNGEST_EVENT_KEY`, jobs such as sanitising run inline after the
request commits. To use the Inngest dev server:

```bash
npx inngest-cli@latest dev
```

and set `INNGEST_DEV=1`.

## Sealing

`SEAL_MODE=development` enables the development seal (self-signed, in-memory key). It is
refused on Vercel production deployments and on `PRODUCTION_HOSTNAME`.
