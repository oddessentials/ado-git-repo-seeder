import { AxiosInstance } from 'axios';
import { RepoStrategy } from '../config.js';

export interface AdoRepo {
    id: string;
    name: string;
    url: string;
    remoteUrl: string;
    defaultBranch?: string;
}

/**
 * Repository CRUD operations for Azure DevOps.
 */
export class RepoManager {
    private client: AxiosInstance;

    constructor(client: AxiosInstance) {
        this.client = client;
    }

    /**
     * Lists all repositories in a project.
     */
    async listRepos(project: string): Promise<AdoRepo[]> {
        const response = await this.client.get(`/${project}/_apis/git/repositories`, {
            params: { 'api-version': '7.1' },
        });
        return response.data?.value ?? [];
    }

    /**
     * Gets a repository by name in a project.
     */
    async getRepo(project: string, repoName: string): Promise<AdoRepo | null> {
        try {
            const response = await this.client.get(
                `/${project}/_apis/git/repositories/${repoName}`,
                { params: { 'api-version': '7.1' } }
            );
            return response.data;
        } catch (error) {
            // Check both sanitized error (.status) and raw axios error (.response.status)
            const status = (error as { status?: number }).status
                ?? (error as { response?: { status?: number } }).response?.status;
            // ADO returns 404 if repo not found
            if (status === 404) {
                return null;
            }
            throw error;
        }
    }

    /**
     * Creates a new repository in a project.
     */
    async createRepo(project: string, repoName: string): Promise<AdoRepo> {
        const response = await this.client.post(
            `/${project}/_apis/git/repositories`,
            { name: repoName },
            { params: { 'api-version': '7.1' } }
        );
        return response.data;
    }

    /**
     * Ensures a repository exists, creating it if necessary, based on strategy.
     */
    async ensureRepo(project: string, repoName: string, strategy: RepoStrategy): Promise<AdoRepo | null> {
        const existing = await this.getRepo(project, repoName);

        if (existing) {
            if (strategy.skipIfExists) {
                return null;
            }
            return existing;
        }

        if (!strategy.createIfMissing) {
            if (strategy.failIfMissing) {
                throw new Error(`FATAL: Repository '${repoName}' does not exist in project '${project}' and createIfMissing is false.`);
            }
            return null;
        }

        return await this.createRepo(project, repoName);
    }
}
