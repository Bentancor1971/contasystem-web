import type { Metadata, Viewport } from "next";
import { Fraunces, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  // Los ~121 KB de Fraunces son el precio de los ejes: next/font no deja
  // acotar `weight` cuando se declaran `axes`, y opsz/SOFT se usan de verdad
  // (globals.css). Se intentó y se revirtió — no "optimizar" de nuevo.
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
  title: "ContaSystem",
  description: "Carga online de comprobantes para ContaSystem",
  applicationName: "ContaSystem",
  appleWebApp: {
    capable: true,
    title: "ContaSystem",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/icon-180.png", type: "image/png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#230d66",
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
      {/*
        El Toaster NO vive acá: react-hot-toast + goober son ~6 KB gzip que
        antes viajaban a TODAS las páginas, incluidas las públicas de alto
        tráfico que no usan toast (/a, /c, /v, /p, /mesa). Se monta con
        <AppToaster/> sólo donde se llama a `toast`: el grupo (app) y las tres
        rutas públicas que lo usan (/e, /login, /empresa), cada una vía su
        layout. Ver components/AppToaster.tsx.
      */}
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
