/**
 * Tests for ADO API client factory functions.
 *
 * Covers retry logic, PAT redaction, and base URL configuration.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { createAdoClient, createIdentityClient } from './client.js';

// Mock axios.create
vi.mock('axios', () => ({
    default: {
        create: vi.fn(() => ({
            interceptors: {
                request: { use: vi.fn() },
                response: { use: vi.fn() },
            },
        })),
    },
}));

describe('ADO Client Factory', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('createAdoClient', () => {
        it('creates client with correct base URL', () => {
            const options = {
                org: 'test-org',
                pat: 'test-pat-12345',
                allPats: ['test-pat-12345'],
            };

            createAdoClient(options);

            expect(axios.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    baseURL: 'https://dev.azure.com/test-org',
                })
            );
        });

        it('sets Authorization header with base64 encoded PAT', () => {
            const options = {
                org: 'my-org',
                pat: 'my-secret-pat',
                allPats: ['my-secret-pat'],
            };

            createAdoClient(options);

            const expectedAuth = `Basic ${Buffer.from(':my-secret-pat').toString('base64')}`;
            expect(axios.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    headers: expect.objectContaining({
                        Authorization: expectedAuth,
                    }),
                })
            );
        });

        it('sets Content-Type header to application/json', () => {
            const options = {
                org: 'org',
                pat: 'pat',
                allPats: ['pat'],
            };

            createAdoClient(options);

            expect(axios.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'Content-Type': 'application/json',
                    }),
                })
            );
        });

        it('registers request and response interceptors', () => {
            const mockClient = {
                interceptors: {
                    request: { use: vi.fn() },
                    response: { use: vi.fn() },
                },
            };
            vi.mocked(axios.create).mockReturnValue(mockClient as any);

            createAdoClient({ org: 'org', pat: 'pat', allPats: ['pat'] });

            expect(mockClient.interceptors.request.use).toHaveBeenCalledTimes(1);
            expect(mockClient.interceptors.response.use).toHaveBeenCalledTimes(1);
        });
    });

    describe('createIdentityClient', () => {
        it('creates client with vssps subdomain', () => {
            const options = {
                org: 'identity-org',
                pat: 'id-pat',
                allPats: ['id-pat'],
            };

            createIdentityClient(options);

            expect(axios.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    baseURL: 'https://vssps.dev.azure.com/identity-org',
                })
            );
        });

        it('registers response interceptor for retry logic', () => {
            const mockClient = {
                interceptors: {
                    request: { use: vi.fn() },
                    response: { use: vi.fn() },
                },
            };
            vi.mocked(axios.create).mockReturnValue(mockClient as any);

            createIdentityClient({ org: 'org', pat: 'pat', allPats: ['pat'] });

            expect(mockClient.interceptors.response.use).toHaveBeenCalledTimes(1);
        });
    });

    describe('Interceptor behavior', () => {
        it('request interceptor marks Authorization header as redacted', () => {
            let requestInterceptor: ((config: any) => any) | null = null;
            const mockClient = {
                interceptors: {
                    request: {
                        use: vi.fn((fn) => {
                            requestInterceptor = fn;
                        }),
                    },
                    response: { use: vi.fn() },
                },
            };
            vi.mocked(axios.create).mockReturnValue(mockClient as any);

            createAdoClient({ org: 'org', pat: 'secret-pat', allPats: ['secret-pat'] });

            expect(requestInterceptor).not.toBeNull();

            // Test the interceptor
            const config = { headers: { Authorization: 'Basic xyz' } };
            const result = requestInterceptor!(config);
            expect(result._redactedAuth).toBe(true);
        });

        it('request interceptor handles missing Authorization header', () => {
            let requestInterceptor: ((config: any) => any) | null = null;
            const mockClient = {
                interceptors: {
                    request: {
                        use: vi.fn((fn) => {
                            requestInterceptor = fn;
                        }),
                    },
                    response: { use: vi.fn() },
                },
            };
            vi.mocked(axios.create).mockReturnValue(mockClient as any);

            createAdoClient({ org: 'org', pat: 'pat', allPats: ['pat'] });

            // Test with no Authorization header
            const config = { headers: {} };
            const result = requestInterceptor!(config);
            expect(result._redactedAuth).toBeUndefined();
        });

        it('response interceptor passes successful responses through', async () => {
            let responseInterceptor: { success: (r: any) => any; error: (e: any) => any } | null = null;
            const mockClient = {
                interceptors: {
                    request: { use: vi.fn() },
                    response: {
                        use: vi.fn((success, error) => {
                            responseInterceptor = { success, error };
                        }),
                    },
                },
            };
            vi.mocked(axios.create).mockReturnValue(mockClient as any);

            createAdoClient({ org: 'org', pat: 'pat', allPats: ['pat'] });

            const mockResponse = { data: { value: 'test' }, status: 200 };
            const result = responseInterceptor!.success(mockResponse);
            expect(result).toEqual(mockResponse);
        });

        it('response interceptor sanitizes errors and redacts PAT', async () => {
            let responseInterceptor: { success: (r: any) => any; error: (e: any) => Promise<any> } | null = null;
            const mockClient = {
                interceptors: {
                    request: { use: vi.fn() },
                    response: {
                        use: vi.fn((success, error) => {
                            responseInterceptor = { success, error };
                        }),
                    },
                },
            };
            vi.mocked(axios.create).mockReturnValue(mockClient as any);

            const secretPat = 'super-secret-pat-12345';
            createAdoClient({ org: 'org', pat: secretPat, allPats: [secretPat] });

            // Error without config (no retry possible)
            const errorWithoutConfig = {
                message: `Failed to authenticate with ${secretPat}`,
                response: { status: 401 },
            };

            await expect(responseInterceptor!.error(errorWithoutConfig)).rejects.toMatchObject({
                name: 'AdoApiError',
                message: expect.not.stringContaining(secretPat),
            });
        });

        it('response interceptor throws sanitized error for 4xx errors (non-retryable)', async () => {
            let responseInterceptor: { success: (r: any) => any; error: (e: any) => Promise<any> } | null = null;
            const mockClient = {
                interceptors: {
                    request: { use: vi.fn() },
                    response: {
                        use: vi.fn((success, error) => {
                            responseInterceptor = { success, error };
                        }),
                    },
                },
            };
            vi.mocked(axios.create).mockReturnValue(mockClient as any);

            createAdoClient({ org: 'org', pat: 'pat', allPats: ['pat'] });

            // 403 Forbidden - should not retry
            const forbiddenError = {
                config: { _retryCount: 0 },
                message: 'Forbidden',
                response: { status: 403, data: { message: 'Access denied' } },
            };

            await expect(responseInterceptor!.error(forbiddenError)).rejects.toMatchObject({
                name: 'AdoApiError',
                status: 403,
            });
        });

        it('response interceptor includes response data in sanitized error', async () => {
            let responseInterceptor: { success: (r: any) => any; error: (e: any) => Promise<any> } | null = null;
            const mockClient = {
                interceptors: {
                    request: { use: vi.fn() },
                    response: {
                        use: vi.fn((success, error) => {
                            responseInterceptor = { success, error };
                        }),
                    },
                },
            };
            vi.mocked(axios.create).mockReturnValue(mockClient as any);

            createAdoClient({ org: 'org', pat: 'pat', allPats: ['pat'] });

            const errorWithData = {
                config: {},
                message: 'Not found',
                response: {
                    status: 404,
                    data: { typeKey: 'GitRepositoryNotFoundError' },
                },
            };

            await expect(responseInterceptor!.error(errorWithData)).rejects.toMatchObject({
                data: { typeKey: 'GitRepositoryNotFoundError' },
            });
        });
    });

    describe('Identity client interceptors', () => {
        it('response interceptor sanitizes errors for identity client', async () => {
            let responseInterceptor: { success: (r: any) => any; error: (e: any) => Promise<any> } | null = null;
            const mockClient = {
                interceptors: {
                    request: { use: vi.fn() },
                    response: {
                        use: vi.fn((success, error) => {
                            responseInterceptor = { success, error };
                        }),
                    },
                },
            };
            vi.mocked(axios.create).mockReturnValue(mockClient as any);

            const secretPat = 'identity-secret-pat';
            createIdentityClient({ org: 'org', pat: secretPat, allPats: [secretPat] });

            const errorWithPat = {
                message: `Identity lookup failed with ${secretPat}`,
                response: { status: 400 },
            };

            await expect(responseInterceptor!.error(errorWithPat)).rejects.toMatchObject({
                name: 'AdoApiError',
                message: expect.not.stringContaining(secretPat),
            });
        });
    });
});
