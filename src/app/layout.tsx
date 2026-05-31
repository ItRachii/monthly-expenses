import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ledger — Monthly Expenses",
  description: "Track every expense, own every dollar.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
