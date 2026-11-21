"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="wrap">
      <h1>Something went wrong</h1>
      <p className="muted">The action didn&apos;t complete. Nothing was lost; try again, or go back to the previous page.</p>
      <div className="row">
        <button className="btn primary" onClick={reset}>Try again</button>
        <a className="btn" href="/">Dashboard</a>
      </div>
    </main>
  );
}
