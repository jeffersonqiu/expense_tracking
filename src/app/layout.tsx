import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = { title: "Expense Tracker", description: "Spending captured from Gmail, reviewed by you." };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
