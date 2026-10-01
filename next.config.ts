import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Next 16 writes AGENTS.md/CLAUDE.md into the repo on dev. This project has
  // its own conventions; the generated files are noise.
  agentRules: false,
};

export default nextConfig;
