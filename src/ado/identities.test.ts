import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IdentityResolver } from './identities.js';
import { AxiosInstance } from 'axios';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock Axios client
function createMockClient(responses: Record<string, unknown>): AxiosInstance {
    return {
        get: vi.fn().mockImplementation((url: string, config?: { params?: Record<string, string> }) => {
            const email = config?.params?.filterValue;
            if (email && responses[email]) {
                return Promise.resolve({ data: responses[email] });
            }
            return Promise.reject({ response: { status: 404 }, message: 'Not found' });
        }),
    } as unknown as AxiosInstance;
}

// Create a unique temp dir for each test to avoid cache collision
function createTempCacheDir(): string {
    return mkdtempSync(join(tmpdir(), 'identity-cache-'));
}

describe('IdentityResolver', () => {
    describe('resolve()', () => {
        it('returns identity ID from API response', async () => {
            const cacheDir = createTempCacheDir();
            const mockClient = createMockClient({
                'user@example.com': {
                    value: [{ id: 'identity-123', displayName: 'Test User' }],
                },
            });

            const resolver = new IdentityResolver(mockClient, 'test-org-1', cacheDir);
            const id = await resolver.resolve('user@example.com');

            expect(id).toBe('identity-123');
            rmSync(cacheDir, { recursive: true, force: true });
        });

        it('caches resolved identities', async () => {
            const cacheDir = createTempCacheDir();
            const mockClient = createMockClient({
                'cached@example.com': {
                    value: [{ id: 'cached-id' }],
                },
            });

            const resolver = new IdentityResolver(mockClient, 'test-org-2', cacheDir);

            // First call
            await resolver.resolve('cached@example.com');
            // Second call should use cache
            await resolver.resolve('cached@example.com');

            expect(mockClient.get).toHaveBeenCalledTimes(1);
            rmSync(cacheDir, { recursive: true, force: true });
        });

        it('throws when identity not found', async () => {
            const cacheDir = createTempCacheDir();
            const mockClient = createMockClient({});

            const resolver = new IdentityResolver(mockClient, 'test-org-3', cacheDir);

            await expect(resolver.resolve('unknown@example.com')).rejects.toThrow();
            rmSync(cacheDir, { recursive: true, force: true });
        });

        it('throws when identity has no ID', async () => {
            const cacheDir = createTempCacheDir();
            const mockClient = createMockClient({
                'noid@example.com': {
                    value: [{ displayName: 'No ID User' }], // Missing id field
                },
            });

            const resolver = new IdentityResolver(mockClient, 'test-org-4', cacheDir);

            await expect(resolver.resolve('noid@example.com')).rejects.toThrow('Identity ID missing');
            rmSync(cacheDir, { recursive: true, force: true });
        });
    });

    describe('invalidate()', () => {
        it('forces re-fetch after invalidation', async () => {
            const cacheDir = createTempCacheDir();
            const mockClient = createMockClient({
                'invalidate@example.com': {
                    value: [{ id: 'original-id' }],
                },
            });

            const resolver = new IdentityResolver(mockClient, 'test-org-5', cacheDir);

            // First call
            await resolver.resolve('invalidate@example.com');

            // Invalidate
            resolver.invalidate('invalidate@example.com');

            // Should call API again
            await resolver.resolve('invalidate@example.com');

            expect(mockClient.get).toHaveBeenCalledTimes(2);
            rmSync(cacheDir, { recursive: true, force: true });
        });
    });

    describe('resolveWithBypass()', () => {
        it('retries once on failure', async () => {
            const cacheDir = createTempCacheDir();
            let callCount = 0;
            const mockClient = {
                get: vi.fn().mockImplementation(() => {
                    callCount++;
                    if (callCount === 1) {
                        return Promise.reject(new Error('Transient failure'));
                    }
                    return Promise.resolve({
                        data: { value: [{ id: 'retry-success' }] },
                    });
                }),
            } as unknown as AxiosInstance;

            const resolver = new IdentityResolver(mockClient, 'test-org-6', cacheDir);
            const id = await resolver.resolveWithBypass('retry@example.com');

            expect(id).toBe('retry-success');
            expect(callCount).toBe(2);
            rmSync(cacheDir, { recursive: true, force: true });
        });
    });

    describe('org scoping', () => {
        it('uses separate cache entries for different orgs', async () => {
            const cacheDir = createTempCacheDir();
            const mockClient = createMockClient({
                'shared@example.com': {
                    value: [{ id: 'org1-id' }],
                },
            });

            // Same cache dir, but different orgs
            const resolver1 = new IdentityResolver(mockClient, 'org-a', cacheDir);
            const resolver2 = new IdentityResolver(mockClient, 'org-b', cacheDir);

            await resolver1.resolve('shared@example.com');
            await resolver2.resolve('shared@example.com');

            // Each org should make its own API call
            expect(mockClient.get).toHaveBeenCalledTimes(2);
            rmSync(cacheDir, { recursive: true, force: true });
        });
    });
});
