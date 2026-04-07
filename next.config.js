/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  basePath: '/mindgrow',
  images: {
    unoptimized: true,
  },
  // Trailing slash for GitHub Pages compatibility
  trailingSlash: true,
  allowedDevOrigins: ["*"],
};
module.exports = nextConfig;
