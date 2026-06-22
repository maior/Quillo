/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // 백엔드가 저장·서빙하는 업로드 이미지를 같은 경로로 프록시 (호스트 독립 경로 유지)
  async rewrites() {
    const api = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8675";
    return [{ source: "/uploads/:path*", destination: `${api}/uploads/:path*` }];
  },
};

module.exports = nextConfig;
