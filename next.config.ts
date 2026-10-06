import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  // Keep route discovery rooted in this project.
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
