import type { Metadata } from "next";
import { Inter, Space_Grotesk, Newsreader } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

// Literary serif — used on the landing headline for a typeset, manuscript feel.
const serif = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Quillo — Collaborative LaTeX Paper Workspace",
    template: "%s · Quillo",
  },
  description:
    "Quillo — an Overleaf-style collaborative LaTeX editor. People and AI agents write and compile papers together.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${display.variable} ${serif.variable}`}>
      <body className="flex min-h-screen flex-col font-sans">
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
