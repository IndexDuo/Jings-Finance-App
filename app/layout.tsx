import type { Metadata, Viewport } from "next";
import "./globals.css";

// Use system fonts (SF Pro on Apple, Segoe on Windows) — matches the iOS design spec.
// We drop Geist here because the app is intentionally native-feeling, not "startup" branded.

export const metadata: Metadata = {
  title: "Finance App",
  description: "Personal finance tracker — paycheck waterfall, envelopes, and investments.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Finance",
  },
  icons: {
    apple: "/apple-icon",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#005FCC",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
