import { LoginButton } from "./LoginButton";

export const metadata = { title: "Sign in · Expense Tracker" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="login">
      <h1>Expense Tracker</h1>
      <p className="muted">Spending captured from your Gmail, reviewed by you.</p>
      {error && <p className="error">Sign-in failed. Your email may not be invited yet.</p>}
      <LoginButton />
    </main>
  );
}
