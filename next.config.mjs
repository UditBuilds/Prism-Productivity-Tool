import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  customWorkerSrc: "worker",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  // MUST stay false. next-pwa's reload listener registers synchronously in
  // sw-entry.js, ahead of TanStack's onlineManager listener, so on reconnect
  // the page reloaded while mutation replay was starting — abandoning
  // in-flight mutations and risking a second replay after the reload.
  reloadOnOnline: false,
  swcMinify: true,
  disable: process.env.NODE_ENV === "development",
  // Show the offline page when a navigation request fails with no cache.
  // (fallbacks is a top-level next-pwa option, NOT a workboxOptions field.)
  //
  // "/offline" is app/offline/page.tsx — a real static route. next-pwa pushes
  // whatever this names into additionalManifestEntries and precaches it, so the
  // value only has to resolve to a document; it does NOT have to be the
  // plugin's own ~offline convention (that name is only auto-filled when
  // `document` is left unset).
  fallbacks: {
    document: "/offline",
  },
  workboxOptions: {
    disableDevLogs: true,
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Don't bundle pdf-parse into the server build — require() it at runtime.
    // Bundling triggers its index.js debug branch (module.parent undefined →
    // fs.readFileSync of a test PDF → ENOENT) and pulls in pdfjs needlessly.
    serverComponentsExternalPackages: ["pdf-parse"],
  },
};

export default withPWA(nextConfig);
