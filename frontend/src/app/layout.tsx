import type { Metadata } from "next";
import localFont from "next/font/local";
import Nav from "@/components/Nav";
import "./globals.css";

// IBM Plex is bundled in ./fonts (SIL Open Font License) so builds never need to reach Google Fonts.
const sans = localFont({ variable: "--font-plex-sans", display: "swap", src: [
  { path: "./fonts/ibm-plex-sans-latin-400-normal.woff2", weight: "400" },
  { path: "./fonts/ibm-plex-sans-latin-500-normal.woff2", weight: "500" },
  { path: "./fonts/ibm-plex-sans-latin-600-normal.woff2", weight: "600" },
  { path: "./fonts/ibm-plex-sans-latin-700-normal.woff2", weight: "700" },
] });
const mono = localFont({ variable: "--font-plex-mono", display: "swap", src: [
  { path: "./fonts/ibm-plex-mono-latin-400-normal.woff2", weight: "400" },
  { path: "./fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500" },
] });

export const metadata: Metadata = { title: "LLMVibeCheck", description: "Build teams of AI models, run them on a task, and find the one that does it best." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-paper text-ink">
        <Nav />
        {children}
      </body>
    </html>
  );
}

