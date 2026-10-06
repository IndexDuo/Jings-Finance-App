import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Finance App",
    short_name: "Finance",
    description: "Personal finance tracker — paycheck waterfall, envelopes, and investments.",
    start_url: "/log",
    display: "standalone",
    background_color: "#F2F2F7",
    theme_color: "#007AFF",
    orientation: "portrait",
    icons: [
      {
        src: "/icon-192",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-512",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
