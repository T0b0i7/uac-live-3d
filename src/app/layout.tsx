import type { Metadata, Viewport } from "next";
import { Inter, Manrope } from "next/font/google";
import "@/styles/globals.css";
import { Providers } from "./providers";
import { Toaster } from "@/components/ui/Toaster";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
  weight: ["500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "UAC-LIVE 3D — Campus Map & Social Radar",
  description:
    "Jumeau numérique social de l'Université d'Abomey-Calavi : carte 3D du campus, radar étudiant, alertes communautaires et navigation piétonne.",
  applicationName: "UAC-LIVE 3D",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "UAC-LIVE 3D",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
  keywords: ["UAC", "Abomey-Calavi", "campus", "3D", "IFRI", "cartographie", "radar social"],
  authors: [{ name: "Eucher ABATTI" }],
};

export const viewport: Viewport = {
  themeColor: "#070b14",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" data-theme="dark" suppressHydrationWarning>
      <body className={`${inter.variable} ${manrope.variable} antialiased`}>
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
