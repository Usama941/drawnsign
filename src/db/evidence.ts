// Insert-only evidence tables (CLAUDE.md rule 6). The app role must never hold UPDATE or
// DELETE on these; the isolation suite checks every one that exists.
export const EVIDENCE_TABLES = [
  "audit_ledger",
  "amendment_events",
  "signature_events",
  "consent_records",
  "document_versions",
  // Also insert-only, beyond the CLAUDE.md list:
  "completion_certificates",
  "verification_tokens",
  "ledger_anchors",
] as const;
