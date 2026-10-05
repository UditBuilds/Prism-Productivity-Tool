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
  // Our rules below go IN FRONT of next-pwa's defaults (resolveRuntimeCaching
  // puts custom entries first), and Workbox uses the first route that
  // matches. Without this flag a custom array would REPLACE the defaults.
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    disableDevLogs: true,
    runtimeCaching: [
      // The OAuth approval page shows who is signed in and which app is
      // asking, for one short-lived request. It must never be stored: the
      // defaults would keep it in "pages" (navigations) and "pages-rsc"
      // (soft navigations). NetworkOnly matches all three request kinds.
      // `options` must exist — next-pwa only attaches the /offline fallback
      // to rules that have one. (The front-end-navigation Worker caches
      // pages outside the service worker; the page itself answers that
      // fetch with 404 — see isBackgroundPageFetch in lib/oauth/consent.ts.)
      {
        urlPattern: ({ sameOrigin, url: { pathname } }) =>
          sameOrigin && pathname.startsWith("/oauth/"),
        handler: "NetworkOnly",
        options: { cacheName: "oauth-never-cached" },
      },
    ],
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
  async headers() {
    return [
      {
        // An Allow button is the classic clickjacking target: no other site
        // may frame the approval page.
        source: "/oauth/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default withPWA(nextConfig);
