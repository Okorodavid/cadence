import type { NextConfig } from "next";

// Your permanent public address, e.g. "cadence.yourdomain.com" — set
// PUBLIC_HOSTNAME in .env. Dev mode rejects requests from hosts not listed in
// allowedDevOrigins, so the tunnel hostname has to be allowed here.
const publicHost = process.env.PUBLIC_HOSTNAME?.trim();

const nextConfig: NextConfig = {
  // Ignored in production (`next start`); only dev mode checks origins.
  allowedDevOrigins: [
    "*.trycloudflare.com", // temporary quick tunnels
    ...(publicHost ? [publicHost] : []),
  ],
};

export default nextConfig;
