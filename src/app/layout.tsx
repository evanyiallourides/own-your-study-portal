import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";

import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  axes: ["opsz"],
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Own Your Study Portal",
    template: "%s · Own Your Study",
  },
  description:
    "The private learning portal for Own Your Study students, tutors and administrators.",
  // The portal is private. Nothing here should ever appear in a search index.
  robots: { index: false, follow: false, nocache: true },
  icons: { icon: "/brand/mark.png" },
};

export const viewport: Viewport = {
  themeColor: "#faf7f1",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${fraunces.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
