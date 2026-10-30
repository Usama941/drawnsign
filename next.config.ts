import type { NextConfig } from "next";
import { assertSealModeAllowed } from "./src/lib/seal-mode";

// Refuse to build a Vercel production deployment with SEAL_MODE=development (CLAUDE.md rule 9).
assertSealModeAllowed();

const nextConfig: NextConfig = {
  poweredByHeader: false,
  typedRoutes: true,
};

export default nextConfig;
