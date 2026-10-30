import { appendAudit } from "@/db/audit";
import { withTenant, type TenantContext, type Tx } from "@/db/tenant";
import { InputError } from "./input";

export interface AuditInfo {
  action?: string;
  objectType?: string;
  objectId?: string | null;
  details?: Record<string, unknown>;
}

export interface ExecutionHooks {
  // Describes the audit entry written for mutating requests. Never put secrets or document
  // content in details.
  audit(info: AuditInfo): void;
  // Runs after the transaction commits (for example, sending email or enqueueing a job that
  // must see the committed rows). Not run if the request rolls back.
  afterCommit(fn: () => Promise<void>): void;
  // Keep this request's writes (and its audit entry) even though it returns an error, e.g. a
  // failed OTP attempt that must still count against the limit.
  commitEvenIfFailed(): void;
}

const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Thrown inside the transaction so a non-2xx response rolls back everything the handler wrote.
class Rollback extends Error {
  constructor(readonly response: Response) {
    super("rollback");
  }
}

// Runs a request handler in one tenant transaction. Mutating requests write exactly one audit
// entry in the same transaction (CLAUDE.md rule 7); non-2xx responses roll back unless the
// handler asked to keep its writes.
export async function executeInTenant(
  req: Request,
  ctx: TenantContext,
  actor: { actorId: string | null; details?: Record<string, unknown> },
  run: (tx: Tx, hooks: ExecutionHooks) => Promise<Response>,
): Promise<Response> {
  const mutating = !READ_ONLY_METHODS.has(req.method);
  const audit: AuditInfo = {};
  const afterCommit: (() => Promise<void>)[] = [];
  let keep = false;

  try {
    const response = await withTenant(ctx, async (tx) => {
      const res = await run(tx, {
        audit: (info) => Object.assign(audit, info),
        afterCommit: (fn) => afterCommit.push(fn),
        commitEvenIfFailed: () => (keep = true),
      });
      if (!res.ok && !keep) throw new Rollback(res);
      if (mutating) {
        await appendAudit(tx, {
          tenantId: ctx.tenantId,
          actorId: actor.actorId,
          action: audit.action ?? `${req.method} ${new URL(req.url).pathname}`,
          objectType: audit.objectType ?? "request",
          objectId: audit.objectId ?? null,
          payload: { method: req.method, status: res.status, ...actor.details, ...audit.details },
        });
      }
      return res;
    });
    if (response.ok) for (const fn of afterCommit) await fn();
    return response;
  } catch (err) {
    if (err instanceof Rollback) return err.response;
    if (err instanceof InputError) return err.response;
    throw err;
  }
}
