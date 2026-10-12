import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/digimine_test',
      JWT_SECRET: 'test-secret',
      LOGIN_MAX_FAILS: '50',
    },
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
