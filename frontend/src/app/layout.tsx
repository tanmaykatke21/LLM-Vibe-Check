import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = { title: "LLMSquad", description: "Which AI team should do this job?" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en"><body className="min-h-screen bg-white text-gray-900">
      <nav className="border-b px-4 py-2 flex gap-5 items-center text-sm">
        <Link href="/" className="font-bold text-base">LLMSquad</Link>
        <Link href="/builder">Builder</Link><Link href="/compare">Compare</Link><Link href="/skills">Skills</Link>
        <span className="ml-auto text-gray-400 text-xs">Which AI team should do this job?</span>
      </nav>
      {children}
    </body></html>
  );
}
