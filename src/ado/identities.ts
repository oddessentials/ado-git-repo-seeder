import { AxiosInstance } from 'axios';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const CACHE_FILE = 'identities.cache.json';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry {
    identityId: string;
    timestamp: number;
}

interface IdentityCache {
    [orgEmail: string]: CacheEntry;
}

/**
 * Manages identity resolution with org-scoped caching and auto-bypass.
 */
export class IdentityResolver {
    private cache: IdentityCache = {};
    private cachePath: string;
    private client: AxiosInstance;
    private org: string;

    constructor(client: AxiosInstance, org: string, cacheDir: string = '.') {
        this.client = client;
        this.org = org;
        this.cachePath = resolve(cacheDir, CACHE_FILE);
        this.loadCache();
    }

    private loadCache(): void {
        if (existsSync(this.cachePath)) {
            try {
                const content = readFileSync(this.cachePath, 'utf-8');
                this.cache = JSON.parse(content) as IdentityCache;
            } catch {
                this.cache = {};
            }
        }
    }

    private saveCache(): void {
        writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 2));
    }

    private cacheKey(email: string): string {
        return `${this.org}:${email.toLowerCase()}`;
    }

    private isExpired(entry: CacheEntry): boolean {
        return Date.now() - entry.timestamp > CACHE_TTL_MS;
    }

    /**
     * Resolves an email to an Azure DevOps identity ID.
     * Uses cache with TTL and auto-bypass on permission errors.
     */
    async resolve(email: string): Promise<string> {
        const key = this.cacheKey(email);
        const cached = this.cache[key];

        if (cached && !this.isExpired(cached)) {
            return cached.identityId;
        }

        // Fetch from API
        const identityId = await this.fetchIdentity(email);

        // Store in cache
        this.cache[key] = {
            identityId,
            timestamp: Date.now(),
        };
        this.saveCache();

        return identityId;
    }

    /**
     * Invalidates the cache entry for an email (used on permission errors).
     */
    invalidate(email: string): void {
        const key = this.cacheKey(email);
        delete this.cache[key];
        this.saveCache();
    }

    /**
     * Attempts to resolve with auto-bypass: invalidates and retries once on failure.
     */
    async resolveWithBypass(email: string): Promise<string> {
        try {
            return await this.resolve(email);
        } catch {
            // Invalidate and retry once
            this.invalidate(email);
            return await this.resolve(email);
        }
    }

    private async fetchIdentity(email: string): Promise<string> {
        const response = await this.client.get('/_apis/identities', {
            params: {
                searchFilter: 'General',
                filterValue: email,
                'api-version': '7.1-preview.1',
            },
        });

        const identities = response.data?.value;
        if (!Array.isArray(identities) || identities.length === 0) {
            throw new Error(`Identity not found for email: ${email}`);
        }

        // Return the first match
        const identity = identities[0];
        if (!identity.id) {
            throw new Error(`Identity ID missing for email: ${email}`);
        }

        return identity.id as string;
    }

    /**
     * Clears all cache entries.
     */
    clearCache(): void {
        this.cache = {};
        this.saveCache();
    }
}
