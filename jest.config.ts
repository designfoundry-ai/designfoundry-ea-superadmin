import type { Config } from 'jest';
import nextJest from 'next/jest.js';

const createJestConfig = nextJest({
  // Resolve next.config.* and .env files relative to repo root.
  dir: './',
});

// Custom config layered on top of next/jest defaults. next/jest wires SWC
// (the same transformer Next uses), respects tsconfig path aliases, and
// transparently handles .ts / .tsx — so we don't need ts-jest.
const customJestConfig: Config = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // Avoid Haste module naming collisions between the source tree and the
  // standalone bundle produced by `next build` (both contain package.json).
  modulePathIgnorePatterns: ['<rootDir>/.next/'],
  // Keep coverage off by default — the goal here is smoke tests, not a
  // coverage gate. Re-enable in CI later when there's a meaningful baseline.
  collectCoverage: false,
  clearMocks: true,
};

export default createJestConfig(customJestConfig);
