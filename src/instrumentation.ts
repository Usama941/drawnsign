import { assertSealModeAllowed } from "@/lib/seal-mode";

// Runs once when a server instance starts: refuse to start with a forbidden seal mode.
export function register(): void {
  assertSealModeAllowed();
}
