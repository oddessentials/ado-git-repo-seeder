/**
 * Tests for RepoManager with sanitized error handling.
 * 
 * IMPORTANT: This test exists because of a bug where repos.ts was checking
 * error.response?.status but client.ts sanitizes errors and puts the status
 * directly on error.status. This mismatch caused 404 "repo not found" errors
 * to throw instead of returning null, breaking repo creation.
 */
import { describe, it, expect, vi } from 'vitest';
import { RepoManager } from './repos.js';

describe('RepoManager error handling', () => {
    describe('getRepo handles sanitized errors', () => {
        it('returns null for 404 when error has .status (sanitized error format)', async () => {
            // Simulates the error format from client.ts sanitizeError()
            const sanitizedError = new Error('Request failed with status code 404');
            (sanitizedError as any).status = 404;
            (sanitizedError as any).name = 'AdoApiError';

            const mockClient = {
                get: vi.fn().mockRejectedValue(sanitizedError),
            };

            const repoManager = new RepoManager(mockClient as any);
            const result = await repoManager.getRepo('my-project', 'nonexistent-repo');

            expect(result).toBeNull();
            expect(mockClient.get).toHaveBeenCalledOnce();
        });

        it('returns null for 404 when error has .response.status (raw axios format)', async () => {
            // Simulates raw axios error before sanitization
            const axiosError = new Error('Request failed with status code 404');
            (axiosError as any).response = { status: 404 };

            const mockClient = {
                get: vi.fn().mockRejectedValue(axiosError),
            };

            const repoManager = new RepoManager(mockClient as any);
            const result = await repoManager.getRepo('my-project', 'nonexistent-repo');

            expect(result).toBeNull();
        });

        it('throws for non-404 sanitized errors', async () => {
            const sanitizedError = new Error('Request failed with status code 403');
            (sanitizedError as any).status = 403;

            const mockClient = {
                get: vi.fn().mockRejectedValue(sanitizedError),
            };

            const repoManager = new RepoManager(mockClient as any);

            await expect(repoManager.getRepo('my-project', 'some-repo'))
                .rejects.toThrow('Request failed with status code 403');
        });

        it('throws for errors without status (network errors)', async () => {
            const networkError = new Error('Network Error');

            const mockClient = {
                get: vi.fn().mockRejectedValue(networkError),
            };

            const repoManager = new RepoManager(mockClient as any);

            await expect(repoManager.getRepo('my-project', 'some-repo'))
                .rejects.toThrow('Network Error');
        });
    });
});
