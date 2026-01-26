/**
 * Tests for RepoManager with sanitized error handling.
 *
 * IMPORTANT: This test exists because of a bug where repos.ts was checking
 * error.response?.status but client.ts sanitizes errors and puts the status
 * directly on error.status. This mismatch caused 404 "repo not found" errors
 * to throw instead of returning null, breaking repo creation.
 */
import { describe, it, expect, vi } from 'vitest';
import { AxiosInstance } from 'axios';
import { RepoManager } from './repos.js';

/**
 * Sanitized error format from client.ts sanitizeError()
 * This interface intentionally mirrors the production error shape where
 * status is placed directly on the error object (not error.response.status).
 * This tests that repos.ts correctly handles both sanitized and raw error formats.
 */
interface SanitizedError extends Error {
    status?: number;
}

/**
 * Raw Axios error format for testing
 */
interface RawAxiosError extends Error {
    response?: { status: number };
}

/**
 * Minimal mock client for testing RepoManager
 */
interface MockRepoClient {
    get: ReturnType<typeof vi.fn>;
    post?: ReturnType<typeof vi.fn>;
}

describe('RepoManager error handling', () => {
    describe('getRepo handles sanitized errors', () => {
        it('returns null for 404 when error has .status (sanitized error format)', async () => {
            // Simulates the error format from client.ts sanitizeError()
            const sanitizedError: SanitizedError = new Error('Request failed with status code 404');
            sanitizedError.status = 404;
            sanitizedError.name = 'AdoApiError';

            const mockClient: MockRepoClient = {
                get: vi.fn().mockRejectedValue(sanitizedError),
            };

            const repoManager = new RepoManager(mockClient as unknown as AxiosInstance);
            const result = await repoManager.getRepo('my-project', 'nonexistent-repo');

            expect(result).toBeNull();
            expect(mockClient.get).toHaveBeenCalledOnce();
        });

        it('returns null for 404 when error has .response.status (raw axios format)', async () => {
            // Simulates raw axios error before sanitization
            const axiosError: RawAxiosError = new Error('Request failed with status code 404');
            axiosError.response = { status: 404 };

            const mockClient: MockRepoClient = {
                get: vi.fn().mockRejectedValue(axiosError),
            };

            const repoManager = new RepoManager(mockClient as unknown as AxiosInstance);
            const result = await repoManager.getRepo('my-project', 'nonexistent-repo');

            expect(result).toBeNull();
        });

        it('throws for non-404 sanitized errors', async () => {
            const sanitizedError: SanitizedError = new Error('Request failed with status code 403');
            sanitizedError.status = 403;

            const mockClient: MockRepoClient = {
                get: vi.fn().mockRejectedValue(sanitizedError),
            };

            const repoManager = new RepoManager(mockClient as unknown as AxiosInstance);

            await expect(repoManager.getRepo('my-project', 'some-repo')).rejects.toThrow(
                'Request failed with status code 403'
            );
        });

        it('throws for errors without status (network errors)', async () => {
            const networkError = new Error('Network Error');

            const mockClient: MockRepoClient = {
                get: vi.fn().mockRejectedValue(networkError),
            };

            const repoManager = new RepoManager(mockClient as unknown as AxiosInstance);

            await expect(repoManager.getRepo('my-project', 'some-repo')).rejects.toThrow('Network Error');
        });
    });

    describe('ensureRepo returns isNew flag correctly', () => {
        it('returns isNew: false for existing repos', async () => {
            const existingRepo = { id: 'existing-id', name: 'my-repo', url: '', remoteUrl: '' };
            const mockClient: MockRepoClient = {
                get: vi.fn().mockResolvedValue({ data: existingRepo }),
            };

            const repoManager = new RepoManager(mockClient as unknown as AxiosInstance);
            const result = await repoManager.ensureRepo('my-project', 'my-repo', {
                createIfMissing: true,
                failIfMissing: false,
                skipIfExists: false,
            });

            expect(result).not.toBeNull();
            expect(result?.repo.id).toBe('existing-id');
            expect(result?.isNew).toBe(false);
        });

        it('returns isNew: true for newly created repos', async () => {
            const sanitized404: SanitizedError = new Error('Not found');
            sanitized404.status = 404;

            const newRepo = { id: 'new-id', name: 'new-repo', url: '', remoteUrl: '' };
            const mockClient: MockRepoClient = {
                get: vi.fn().mockRejectedValue(sanitized404),
                post: vi.fn().mockResolvedValue({ data: newRepo }),
            };

            const repoManager = new RepoManager(mockClient as unknown as AxiosInstance);
            const result = await repoManager.ensureRepo('my-project', 'new-repo', {
                createIfMissing: true,
                failIfMissing: false,
                skipIfExists: false,
            });

            expect(result).not.toBeNull();
            expect(result?.repo.id).toBe('new-id');
            expect(result?.isNew).toBe(true);
        });

        it('returns null when skipIfExists and repo exists', async () => {
            const existingRepo = { id: 'existing-id', name: 'my-repo', url: '', remoteUrl: '' };
            const mockClient: MockRepoClient = {
                get: vi.fn().mockResolvedValue({ data: existingRepo }),
            };

            const repoManager = new RepoManager(mockClient as unknown as AxiosInstance);
            const result = await repoManager.ensureRepo('my-project', 'my-repo', {
                createIfMissing: false,
                failIfMissing: false,
                skipIfExists: true,
            });

            expect(result).toBeNull();
        });
    });
});
