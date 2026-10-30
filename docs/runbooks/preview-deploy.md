# Set up a preview link (no coding needed)

This guide gets you a private web address where you can try drawnsign end to end: create an account, upload a PDF, send it, sign it, and verify it. It uses three free services:

- **Neon** for the database
- **Vercel** to run the app
- **Vercel Blob** to store PDFs

It takes about 30 minutes. You only need a web browser and your GitHub login.

Everything on a preview is test data. Documents are sealed with a **development seal** that is clearly marked "not trusted", so nothing you sign here is legally meaningful.

---

## What you will copy, at a glance

Keep a private note (for example in your password manager) while you work. You will end up with these values:

| Name in Vercel | Where it comes from | Example shape |
| --- | --- | --- |
| `DATABASE_URL_MIGRATOR` | Neon, **direct** connection string | `postgresql://neondb_owner:abc123@ep-cool-name-123456.eu-west-2.aws.neon.tech/neondb?sslmode=require` |
| `APP_DB_PASSWORD` | You create it (32 letters and digits) | `k3J9xQ2mV8pL5rT1wZ7cB4nH6yF0dA2s` |
| `DATABASE_URL` | Neon, **pooled** connection string, edited (step 2.4) | `postgresql://app_user:k3J9...@ep-cool-name-123456-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require` |
| `BETTER_AUTH_SECRET` | You create it (64 letters and digits) | `9fK2...` |
| `DEV_OUTBOX_KEY` | You create it (24 letters and digits) | `Qm7...` |
| `BLOB_READ_WRITE_TOKEN` | Added by Vercel automatically when you connect Blob (step 4) | `vercel_blob_rw_...` |

Plus these fixed values, typed exactly as shown:

| Name | Value |
| --- | --- |
| `SEAL_MODE` | `development` |
| `EMAIL_MODE` | `outbox` |
| `PREVIEW_SELF_SIGNUP` | `true` |
| `UPLOAD_MODE` | `blob` |

**Creating the random values:** use your password manager's generator. Choose **letters and digits only, no symbols**, because symbols can break the database address. Never reuse a real password.

---

## 1. Create the database (Neon)

1. Go to **neon.com** and click **Sign up**. Signing up with GitHub is easiest. The **Free** plan is enough.
2. Create a project:
   - **Project name:** `drawnsign-preview`
   - **Postgres version:** leave the default.
   - **Region:** pick **AWS Europe (London)** if offered, otherwise the nearest one to you.
   - Click **Create project**.
3. On the project dashboard, click **Connect** (top right). A box with a connection string appears.

## 2. Copy the two database addresses

1. In the **Connect** box, make sure the database is `neondb` and the role is `neondb_owner`.
2. Switch **Connection pooling** **off**. Click **Copy snippet** (or the copy icon) for the connection string. Save it in your note as **`DATABASE_URL_MIGRATOR`**. It must start with `postgresql://` and must **not** contain `-pooler`.
3. Switch **Connection pooling** **on** and copy the string again. Save it in your note as **"pooled string"**. This one contains `-pooler` in the middle.
4. Build **`DATABASE_URL`** from the pooled string. It looks like this:

   ```
   postgresql://neondb_owner:ORIGINALPASSWORD@ep-...-pooler.REGION.aws.neon.tech/neondb?sslmode=require
   ```

   Replace `neondb_owner:ORIGINALPASSWORD` (the part between `//` and `@`) with `app_user:` followed by your `APP_DB_PASSWORD`:

   ```
   postgresql://app_user:YOUR_APP_DB_PASSWORD@ep-...-pooler.REGION.aws.neon.tech/neondb?sslmode=require
   ```

   Change nothing else. Save it as **`DATABASE_URL`**.

You don't create `app_user` yourself. The app creates it the first time it deploys, using `APP_DB_PASSWORD`. That role can only read and write data under the app's security rules; it can never change the database structure.

## 3. Create the Vercel project

1. Go to **vercel.com** and **Sign up** with GitHub. The **Hobby** (free) plan is enough.
2. Click **Add New… → Project**.
3. Under **Import Git Repository**, find **`Usama941/drawnsign`** and click **Import**.
   - If it isn't listed, click **Adjust GitHub App Permissions** and give Vercel access to that repository.
4. On the **Configure Project** screen:
   - **Framework Preset:** Next.js (detected automatically).
   - Leave **Root Directory**, **Build Command** and **Install Command** as they are.
   - Open **Environment Variables** and add every value from the tables above **except `BLOB_READ_WRITE_TOKEN`** (that comes in step 4).
5. Click **Deploy**. This first deployment is the "Production" one. It is fine if it shows errors or can't seal documents, because we won't use it (see "Why not the Production link?" below).

## 4. Add PDF storage (Vercel Blob)

1. In your Vercel project, open the **Storage** tab.
2. Click **Create Database** (or **Create**) → **Blob** → **Continue**.
   - **Name:** `drawnsign-preview-blob`
   - If asked for access, choose **Private**.
   - Click **Create**.
3. When asked which environments to connect, tick **Preview** (and **Development** if offered). Untick **Production**. Click **Connect**.
4. Vercel adds `BLOB_READ_WRITE_TOKEN` to the project for you. Check it under **Settings → Environment Variables**.

## 5. Point the variables at Preview

1. Go to **Settings → Environment Variables**.
2. For each variable you added in step 3, click the **⋯** menu → **Edit** and make sure **Preview** is ticked.
3. Make sure `SEAL_MODE`, `EMAIL_MODE`, `PREVIEW_SELF_SIGNUP` and `DEV_OUTBOX_KEY` are **not** ticked for **Production**. The app refuses to build a Production deployment with `SEAL_MODE=development`, by design.

## 6. Open the preview link

Previews are built from the development branch, `claude/brave-ramanujan-dh2ylj`.

1. Open the **Deployments** tab. Find the newest deployment marked **Preview** for that branch.
   - If there is none yet, or it was built before you added the variables, open its **⋯** menu and click **Redeploy**.
2. When it shows **Ready**, click it. Under **Domains**, copy the address that contains `git-claude-brave-ramanujan` (for example `drawnsign-git-claude-brave-ramanujan-dh2ylj-yourname.vercel.app`). This is your **preview link**. It stays the same as the branch gets new work.

Always use that branch address, not the one with a random code in it. Sign-in cookies and email links are set up for the branch address.

## 7. Try it

1. Open the preview link. Vercel may ask you to log in to Vercel first; previews are private to your Vercel account by default.
2. Click **Create an account** and sign up.
3. Open **`/dev/outbox`** on the preview link (for example `https://drawnsign-git-...vercel.app/dev/outbox`). Enter your `DEV_OUTBOX_KEY` and click **Open**. Every email the app "sends" appears here instead of being delivered. Click the verification link.
4. Go to **Sign in**, sign in, then click **Create my workspace**.
5. Upload a PDF, click **Prepare and send**, add yourself (any email address) as the recipient, click the page to place a signature box, and click **Send for signature**.
6. Back in the outbox, click **Refresh**, open the signing link, agree, click **Email me a code**, and read the code from the outbox. Sign.
7. On the **Documents** page, download the signed PDF. Its footer shows **DEVELOPMENT SEAL - NOT FOR REAL USE** and a QR code. Scan the QR code with your phone, or open the verify link, to see the verify page with its amber development-seal banner. Use **Check a copy** to compare a file against the signed version.

## Why not the Production link?

The Production deployment (built from `main`) must never carry a development seal, so it has none of the preview settings. Until go-live requirements are met (real sealing key, locked storage), it can't seal documents. Use the preview link.

## If something goes wrong

| What you see | What to do |
| --- | --- |
| Build fails with `APP_DB_PASSWORD must be at least 24 characters` | Make the password longer (32 letters and digits) and redeploy. |
| Build fails mentioning `password authentication failed` | `DATABASE_URL_MIGRATOR` is wrong. Copy the **direct** string from Neon again. |
| The site loads but sign-in or sign-up fails with a server error | `DATABASE_URL` is wrong. Check it uses `app_user` and exactly your `APP_DB_PASSWORD`, and that it contains `-pooler`. |
| "The preview outbox is not enabled on this deployment." | `EMAIL_MODE=outbox` or `DEV_OUTBOX_KEY` is missing for Preview. Add it and redeploy. |
| Upload fails | Blob isn't connected to Preview (step 4), or `UPLOAD_MODE=blob` is missing. Redeploy after fixing. |
| The signed PDF never appears | `SEAL_MODE=development` is missing for Preview. Add it and redeploy. |
| Signing links open a Vercel login page | That is Vercel's preview protection. Open them in a browser where you are logged in to Vercel, or turn it off under **Settings → Deployment Protection**. Only turn it off if you're comfortable with the preview being reachable by anyone who has the link. |

Changing a variable never affects a deployment that already exists. Always **Redeploy** afterwards.
