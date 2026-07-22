/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  experimental: {
    // Keep server-only heavy deps out of the client bundle.
    serverComponentsExternalPackages: ["bullmq", "ioredis", "unzipper"],
  },
};

export default nextConfig;
