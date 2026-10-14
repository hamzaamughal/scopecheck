import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { InlineScript } from "@/components/inline-script";
import "./globals.css";

const geist = localFont({ src: "../../public/fonts/geist-variable.woff2", variable: "--font-body", weight: "100 900", display: "swap" });
const geistMono = localFont({ src: "../../public/fonts/geist-mono-variable.woff2", variable: "--font-mono-ui", weight: "100 900", display: "swap" });

export const metadata: Metadata = {
  title: "ScopeCheck — Clear scope. Better conversations.",
  description: "Review client requests against agreed project scope and record clear decisions.",
};

export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: dark)", color: "#101116" }, { media: "(prefers-color-scheme: light)", color: "#fafbfc" }],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return <html lang="en" className={`${geist.variable} ${geistMono.variable}`} data-theme="dark" suppressHydrationWarning>
    <head>
      {/* Apply a saved preference before paint; new visitors start in dark mode. */}
      <InlineScript html={`try{document.documentElement.dataset.theme=localStorage.getItem("scopecheck-theme")==="light"?"light":"dark"}catch(e){}`}/>
    </head>
    <body>{children}</body>
  </html>;
}
