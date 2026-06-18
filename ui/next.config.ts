import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

const uiRoot = fileURLToPath(new URL('.', import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: uiRoot,
  },
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: ['**/.git/**', '**/.next/**', '**/node_modules/**'],
      };
    }

    return config;
  },
  outputFileTracingIncludes: {
    '/api/analyze-game': ['./bin/**/*'],
    '/api/analyze-position': ['./bin/**/*'],
    '/api/training-deck': [
      './scripts/chesscom/**/*',
      './scripts/supabase/env.mjs',
      './lib/opening-book-keys.json',
      './node_modules/@supabase/**/*',
      './node_modules/@supabase/phoenix/**/*',
      './node_modules/chess.js/**/*',
      './node_modules/iceberg-js/**/*',
      './node_modules/tslib/**/*',
    ],
  },
};

export default nextConfig;
