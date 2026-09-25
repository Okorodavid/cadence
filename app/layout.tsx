import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/nav";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Cadence — AI influencer + YouTube OS",
  description:
    "Set a character and a schedule. Cadence produces the posts and videos on a calendar and exports them ready to publish. Powered by the Higgsfield API.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} min-h-dvh bg-ink`}>
        <Nav />
        <main className="mx-auto w-full max-w-[1600px] px-4 pb-24 sm:px-6">
          {children}
        </main>
      </body>
    </html>
  );
}
