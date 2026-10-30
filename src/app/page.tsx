import Link from "next/link";

export default function Home() {
  return (
    <main className="stack" style={{ maxWidth: 560 }}>
      <h1>drawnsign</h1>
      <p>Upload a PDF, place signature fields, and send it for signature.</p>
      <p className="row">
        <Link href="/login">Sign in</Link>
        <Link href="/signup">Create an account</Link>
        <Link href="/documents">Your documents</Link>
      </p>
    </main>
  );
}
