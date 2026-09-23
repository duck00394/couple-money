import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // 打卡照片在瀏覽器壓縮後通常 < 500KB，保留一些空間
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;
