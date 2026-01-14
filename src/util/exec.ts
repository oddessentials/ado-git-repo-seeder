import { spawn } from 'node:child_process';

export interface ExecResult {
    stdout: string;
    stderr: string;
    code: number;
}

/**
 * Executes a shell command with the given arguments.
 * Redacts any PATs from outputs.
 */
export async function exec(
    command: string,
    args: string[],
    options: {
        cwd?: string;
        env?: NodeJS.ProcessEnv;
        patsToRedact?: string[];
    } = {}
): Promise<ExecResult> {
    const { cwd, env, patsToRedact = [] } = options;

    return new Promise((resolve, reject) => {
        // Quote arguments with spaces for shell execution (especially important on Windows)
        const escapedArgs = args.map((arg) => {
            if (arg === '' || arg.includes(' ') || arg.includes('\t') || arg.includes('\n')) {
                return `"${arg.replaceAll('"', '\\"')}"`;
            }
            return arg;
        });

        const proc = spawn(command, escapedArgs, {
            cwd,
            // Preserve Windows-critical env vars to avoid cmd.exe ENOENT
            // These must come AFTER the spread to ensure they're not overwritten
            env: {
                ...process.env,
                ...env,
                GIT_TERMINAL_PROMPT: '0',
                // Explicitly preserve Windows shell environment
                ComSpec: process.env.ComSpec,
                SYSTEMROOT: process.env.SYSTEMROOT,
                SystemRoot: process.env.SystemRoot, // Windows uses both cases
                PATH: process.env.PATH,
                TEMP: process.env.TEMP,
                TMP: process.env.TMP,
                USERPROFILE: process.env.USERPROFILE,
            },
            shell: true,
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('error', (err) => {
            reject(new Error(redactSecrets(`Exec error: ${err.message}`, patsToRedact)));
        });

        proc.on('close', (code) => {
            resolve({
                stdout: redactSecrets(stdout, patsToRedact),
                stderr: redactSecrets(stderr, patsToRedact),
                code: code ?? 1,
            });
        });
    });
}

function redactSecrets(str: string, pats: string[]): string {
    let result = str;
    for (const pat of pats) {
        if (pat) {
            result = result.replaceAll(pat, '[REDACTED]');
        }
    }
    return result;
}
