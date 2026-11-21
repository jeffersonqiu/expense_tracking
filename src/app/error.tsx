"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="login">
      <div className="box">
        <h1>Something went wrong</h1>
        <p>That didn&apos;t complete. Nothing was lost. Try again, or head back to your summary.</p>
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <button className="btn primary" onClick={reset}>Try again</button>
          <a className="btn" href="/">Summary</a>
        </div>
      </div>
    </main>
  );
}
