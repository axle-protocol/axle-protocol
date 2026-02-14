/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // Handle node: protocol imports from @solana/web3.js
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      os: false,
      path: false,
      crypto: false,
      stream: false,
      http: false,
      https: false,
      zlib: false,
    };
    return config;
  },
};

module.exports = nextConfig;
