import type { Metadata, Viewport } from "next";
import { Fraunces, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { Toaster } from "react-hot-toast";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  axes: ["opsz", "SOFT"],
  variable: "--font-fraunces",
  display: "swap",
});

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ContaSystem Carga",
  description: "Carga online de comprobantes para ContaSystem",
  applicationName: "ContaSystem Carga",
  appleWebApp: {
    capable: true,
    title: "CS Carga",
    statusBarStyle: "default",
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#f59e0b",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${fraunces.variable} ${plexSans.variable} ${plexMono.variable} h-full`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster
          position="bottom-center"
          toastOptions={{
            style: {
              background: "var(--color-ink)",
              color: "var(--color-paper)",
              padding: "12px 18px",
              borderRadius: "8px",
              fontSize: "14px",
              fontFamily: "var(--font-sans)",
              boxShadow: "0 12px 32px rgba(26,24,20,0.30)",
            },
            success: {
              iconTheme: { primary: "var(--color-amber)", secondary: "var(--color-ink)" },
            },
            error: {
              iconTheme: { primary: "var(--color-status-no)", secondary: "var(--color-paper)" },
            },
          }}
        />
      </body>
    </html>
  );
}
