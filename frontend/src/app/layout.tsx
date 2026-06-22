import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
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

export const metadata: Metadata = {
  title: {
    default: "Quillo — 협업 LaTeX 논문 워크스페이스",
    template: "%s · Quillo",
  },
  description:
    "Quillo — Overleaf 스타일 협업 LaTeX 에디터. 사람과 AI 에이전트가 함께 논문을 쓰고 컴파일한다.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" className={`${inter.variable} ${display.variable}`}>
      <body className="flex min-h-screen flex-col font-sans">
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
