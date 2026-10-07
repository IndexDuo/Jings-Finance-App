import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { APP_DESCRIPTION, APP_NAME, APP_SHORT_NAME } from "@/lib/app-info";
import { isDemoMode } from "@/lib/demo/config";
import "./globals.css";

// Use system fonts (SF Pro on Apple, Segoe on Windows) — matches the iOS design spec.
// We drop Geist here because the app is intentionally native-feeling, not "startup" branded.

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_DESCRIPTION,
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: APP_SHORT_NAME,
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
  const configuredAnalyticsId = process.env.DEMO_GOOGLE_ANALYTICS_ID;
  const analyticsId = isDemoMode() && configuredAnalyticsId && /^G-[A-Z0-9]+$/.test(configuredAnalyticsId)
    ? configuredAnalyticsId
    : null;

  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {children}
        {analyticsId && <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${analyticsId}`} strategy="afterInteractive" />
          <Script id="demo-google-analytics" strategy="afterInteractive">{`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', ${JSON.stringify(analyticsId)});
          `}</Script>
        </>}
      </body>
    </html>
  );
}
