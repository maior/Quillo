/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // Proxy upload images stored & served by the backend under the same path (keeps host-independent paths)
  async rewrites() {
    const api = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8675";
    return [{ source: "/uploads/:path*", destination: `${api}/uploads/:path*` }];
  },
};

module.exports = nextConfig;
