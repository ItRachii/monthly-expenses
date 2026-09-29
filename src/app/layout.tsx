import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PWARegister } from "@/components/PWARegister";
import { ThemeSync } from "@/components/ThemeSync";
import { THEME_SCRIPT } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Ledger: monthly expenses",
  description: "Track every expense, own every rupee.",
  applicationName: "Ledger",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Ledger",
    statusBarStyle: "black",
  },
  icons: {
    icon: "/icon-192.png",
    shortcut: "/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0E1117",
  // Let content extend into the safe-area zones; the app layout pads for them.
  viewportFit: "cover",
  // Android: the keyboard shrinks the layout, as on iOS, so a bottom sheet
  // with a focused field rises above the keyboard instead of under it.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // data-theme is dark on the server and replaced before first paint by
    // THEME_SCRIPT, hence suppressHydrationWarning on this one element.
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="font-sans antialiased">
        {children}
        <ThemeSync />
        <PWARegister />
      </body>
    </html>
  );
}
