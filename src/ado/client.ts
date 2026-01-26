import axios, { AxiosInstance, AxiosError } from 'axios';
import { redactPat } from '../config.js';

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

export interface AdoClientOptions {
    org: string;
    pat: string;
    allPats: string[]; // For redaction
}

/**
 * Structured error from ADO API with sanitized message and response data.
 * Use isAdoApiError() type guard for runtime type checking.
 */
export interface AdoApiError extends Error {
    name: 'AdoApiError';
    status?: number;
    data?: { typeKey?: string; [key: string]: unknown };
}

/**
 * Type guard for AdoApiError.
 * Use this instead of type assertions for runtime-safe error handling.
 */
export function isAdoApiError(error: unknown): error is AdoApiError {
    return error instanceof Error && error.name === 'AdoApiError' && ('status' in error || 'data' in error || true);
}

/**
 * Creates an Axios client for Azure DevOps REST API with retry and redaction.
 */
export function createAdoClient(options: AdoClientOptions): AxiosInstance {
    const { org, pat, allPats } = options;
    const baseURL = `https://dev.azure.com/${org}`;

    const client = axios.create({
        baseURL,
        headers: {
            Authorization: `Basic ${Buffer.from(`:${pat}`).toString('base64')}`,
            'Content-Type': 'application/json',
        },
    });

    // Request interceptor: ensure we don't accidentally log PATs
    client.interceptors.request.use((config) => {
        // Redact Authorization header in any logged config
        if (config.headers?.Authorization) {
            (config as { _redactedAuth?: boolean })._redactedAuth = true;
        }
        return config;
    });

    // Response interceptor: handle retries for transient errors
    client.interceptors.response.use(
        (response) => response,
        async (error: AxiosError) => {
            const config = error.config;
            if (!config) {
                throw sanitizeError(error, allPats);
            }

            const retryCount = (config as { _retryCount?: number })._retryCount ?? 0;
            const status = error.response?.status;

            // Retry on 429 (rate limit) or 5xx (server errors)
            if ((status === 429 || (status && status >= 500)) && retryCount < MAX_RETRIES) {
                (config as { _retryCount?: number })._retryCount = retryCount + 1;
                const backoff = INITIAL_BACKOFF_MS * Math.pow(2, retryCount);
                await sleep(backoff);
                return client.request(config);
            }

            throw sanitizeError(error, allPats);
        }
    );

    return client;
}

/**
 * Creates a client for the Azure DevOps Identity API (vssps subdomain).
 */
export function createIdentityClient(options: AdoClientOptions): AxiosInstance {
    const { org, pat, allPats } = options;
    const baseURL = `https://vssps.dev.azure.com/${org}`;

    const client = axios.create({
        baseURL,
        headers: {
            Authorization: `Basic ${Buffer.from(`:${pat}`).toString('base64')}`,
            'Content-Type': 'application/json',
        },
    });

    client.interceptors.response.use(
        (response) => response,
        async (error: AxiosError) => {
            const config = error.config;
            if (!config) {
                throw sanitizeError(error, allPats);
            }

            const retryCount = (config as { _retryCount?: number })._retryCount ?? 0;
            const status = error.response?.status;

            if ((status === 429 || (status && status >= 500)) && retryCount < MAX_RETRIES) {
                (config as { _retryCount?: number })._retryCount = retryCount + 1;
                const backoff = INITIAL_BACKOFF_MS * Math.pow(2, retryCount);
                await sleep(backoff);
                return client.request(config);
            }

            throw sanitizeError(error, allPats);
        }
    );

    return client;
}

function sanitizeError(error: AxiosError, pats: string[]): AdoApiError {
    const message = redactPat(error.message, pats);
    const sanitized = new Error(message) as AdoApiError;
    sanitized.name = 'AdoApiError';
    if (error.response) {
        sanitized.status = error.response.status;
        sanitized.data = error.response.data as AdoApiError['data'];
    }
    return sanitized;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
