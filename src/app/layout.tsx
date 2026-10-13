import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const inter = localFont({ src: "../../public/fonts/inter-variable.ttf", variable: "--font-body", weight: "100 900", display: "swap" });
const manrope = localFont({ src: "../../public/fonts/manrope-variable.ttf", variable: "--font-heading", weight: "200 800", display: "swap" });

export const metadata: Metadata = {
  title: "ScopeCheck — Clear scope. Better conversations.",
  description: "Review client requests against agreed project scope and record clear decisions.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return <html lang="en" className={`${inter.variable} ${manrope.variable}`} data-theme="dark" suppressHydrationWarning>
    <head>
      {/* Apply a saved preference before paint; new visitors start in dark mode. */}
      <script dangerouslySetInnerHTML={{ __html: `try{document.documentElement.dataset.theme=localStorage.getItem("scopecheck-theme")==="light"?"light":"dark"}catch{}` }}/>
    </head>
    <body>{children}</body>
  </html>;
}
