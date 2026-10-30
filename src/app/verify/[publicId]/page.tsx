import { Suspense } from "react";
import { VerifyClient } from "./verify-client";

export default function VerifyPage() {
  return (
    <Suspense
      fallback={
        <main>
          <p>Checking…</p>
        </main>
      }
    >
      <VerifyClient />
    </Suspense>
  );
}
