import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    fileParallelism: false,
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          d1Databases: ['DB'],
          compatibilityDate: '2024-11-01',
          compatibilityFlags: ['nodejs_compat']
        }
      }
    }
  }
});
