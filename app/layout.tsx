import type { Metadata, Viewport } from "next";
import { Instrument_Sans, JetBrains_Mono, Newsreader } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { THEME_COLOR, colorModeScript } from "@/lib/color-mode";

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

// Reading text in lessons (DESIGN.md, Type). Only regular is used.
const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PRISM",
  description: "Personal productivity with AI-native spaced repetition.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Prism",
  },
  icons: {
    apple: [
      { url: "/icons/icon-152.png" },
      { url: "/icons/icon-192.png", sizes: "180x180" },
    ],
  },
};

// theme-color is NOT set here: it is rendered by hand in <head> below so the
// pre-paint script can repoint it for light mode before first paint.
export const viewport: Viewport = {
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
      lang="en"
      className={`dark ${instrumentSans.variable} ${jetbrainsMono.variable} ${newsreader.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Dark is the server's frame; the script below repoints this for light.
            Above the script so it already exists when the script runs. */}
        <meta
          name="theme-color"
          content={THEME_COLOR.dark}
          suppressHydrationWarning
        />
        {/* Apply the saved accent theme and colour mode before first paint
            (no violet flash, no dark-to-light flash). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("prism-theme");if(t)document.documentElement.classList.add("theme-"+t);${colorModeScript()}}catch(e){}`,
          }}
        />
      </head>
      <body className="font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
