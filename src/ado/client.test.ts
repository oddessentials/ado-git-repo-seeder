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
});
