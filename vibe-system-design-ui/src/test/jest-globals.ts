// Provide jest globals for jest-canvas-mock compatibility
import { vi } from "vitest";

const globalAny = globalThis as any;
globalAny.jest = vi;
// vitest globals are already available as globalThis.describe, etc. when globals: true
// but we need to ensure they're available for jest-canvas-mock
globalAny.describe = globalAny.describe;
globalAny.it = globalAny.it;
globalAny.test = globalAny.test;
globalAny.expect = globalAny.expect;
globalAny.beforeEach = globalAny.beforeEach;
globalAny.afterEach = globalAny.afterEach;
globalAny.beforeAll = globalAny.beforeAll;
globalAny.afterAll = globalAny.afterAll;