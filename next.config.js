/** @type {import('next').NextConfig} */
const isProduction = process.env.NODE_ENV === 'production';
const nextConfig = {
  output: isProduction ? 'export' : undefined,
  basePath: isProduction ? '/mindgrow' : '',
  images: {
    unoptimized: true,
  },
  trailingSlash: isProduction ? true : false,
  allowedDevOrigins: ["*"],
};
module.exports = nextConfig;
