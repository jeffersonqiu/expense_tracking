import { LoginButton } from "./LoginButton";
import { IconWallet } from "../ui/Icons";

export const metadata = { title: "Sign in · Expenses" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="login">
      <div className="box">
        <div className="app-icon"><IconWallet /></div>
        <h1>Expenses</h1>
        <p>Spending captured from Gmail, reviewed by you.</p>
        {error && <div className="banner bad" role="alert">Sign-in didn&apos;t work. Your email may not be invited yet.</div>}
        <LoginButton />
      </div>
    </main>
  );
}
