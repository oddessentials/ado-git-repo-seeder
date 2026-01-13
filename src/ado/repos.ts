import { AxiosInstance } from 'axios';

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
            if ((error as { status?: number }).status === 404) {
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
     * Ensures a repository exists, creating it if necessary.
     */
    async ensureRepo(project: string, repoName: string): Promise<AdoRepo> {
        const existing = await this.getRepo(project, repoName);
        if (existing) {
            return existing;
        }
        return await this.createRepo(project, repoName);
    }
}
