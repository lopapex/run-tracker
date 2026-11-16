import type { NextConfig } from 'next';

// Do M5 nemá aplikace server: statický export stačí a Netlify ho servíruje z CDN.
const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  experimental: { optimizePackageImports: ['@phosphor-icons/react'] },
};

export default config;
