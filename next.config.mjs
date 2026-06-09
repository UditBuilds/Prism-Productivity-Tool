import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  customWorkerSrc: "worker",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  swcMinify: true,
  disable: process.env.NODE_ENV === "development",
  // Show the offline page when a navigation request fails with no cache.
  // (fallbacks is a top-level next-pwa option, NOT a workboxOptions field.)
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
