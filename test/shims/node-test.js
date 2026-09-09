// test/shims/node-test.js
// Adapter that maps node:test APIs to Jest globals

function createTestContext() {
    const ctx = {
        test: async (name, fn) => {
            if (typeof fn === 'function') {
                await fn(createTestContext());
            }
        },
        skip: () => {},
        todo: () => {},
        diagnostic: () => {}
    };
    return ctx;
}

export function test(name, optionsOrFn, maybeFn) {
    const fn = typeof optionsOrFn === 'function' ? optionsOrFn : maybeFn;
    if (typeof globalThis.test === 'function') {
        return globalThis.test(name, async () => {
            if (typeof fn === 'function') {
                await fn(createTestContext());
            }
        });
    }
}

test.test = test;
test.describe = function describe(name, fn) {
    if (typeof globalThis.describe === 'function') {
        return globalThis.describe(name, fn);
    }
    return fn();
};
test.it = function it(name, optionsOrFn, maybeFn) {
    const fn = typeof optionsOrFn === 'function' ? optionsOrFn : maybeFn;
    if (typeof globalThis.it === 'function') {
        return globalThis.it(name, async () => {
            if (typeof fn === 'function') {
                await fn(createTestContext());
            }
        });
    }
};
test.before = (fn) => (globalThis.beforeAll || globalThis.before)?.(fn);
test.after = (fn) => (globalThis.afterAll || globalThis.after)?.(fn);
test.beforeEach = (fn) => globalThis.beforeEach?.(fn);
test.afterEach = (fn) => globalThis.afterEach?.(fn);

export const describe = test.describe;
export const it = test.it;
export const before = test.before;
export const after = test.after;
export const beforeEach = test.beforeEach;
export const afterEach = test.afterEach;

export default test;
