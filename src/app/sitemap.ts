import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://yunzhixu620-stack.github.io/mindgrow";
  return [
    { url: `${base}/`, lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
    { url: `${base}/guide/`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/universe/`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 },
  ];
}
