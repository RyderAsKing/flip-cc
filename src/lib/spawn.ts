import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';

export interface SpawnOptions {
  envOverrides?: Record<string, string | undefined>;
  cwd?: string;
}

/**
 * Spawns a child process with stdio inheritance and optional env overrides.
 * @param command - The command to spawn
 * @param args - Arguments for the command
 * @param options - Spawn options including env overrides
 * @returns Promise that resolves on exit code 0, rejects otherwise
 */
export function spawnWithInheritance(
  command: string,
  args: string[] = [],
  options: SpawnOptions = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    let env = process.env;
    if (options.envOverrides) {
      env = { ...process.env };
      for (const [key, value] of Object.entries(options.envOverrides)) {
        if (value === undefined) {
          delete env[key];
        } else {
          env[key] = value;
        }
      }
    }

    const isWindows = process.platform === 'win32';

    const spawnOptions: Parameters<typeof spawn>[2] = {
      stdio: 'inherit',
      env,
      shell: isWindows,
    };

    if (options.cwd) {
      spawnOptions.cwd = options.cwd;
    }

    const child: ChildProcess = spawn(command, args, spawnOptions);

    // Forward SIGINT and SIGTERM to child
    const signalHandler = (signal: NodeJS.Signals) => {
      if (child.pid) {
        try {
          process.kill(child.pid, signal);
        } catch {
          // Child may have already exited
        }
      }
    };

    process.on('SIGINT', signalHandler);
    process.on('SIGTERM', signalHandler);

    child.on('close', (code) => {
      process.off('SIGINT', signalHandler);
      process.off('SIGTERM', signalHandler);

      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Process exited with code ${code ?? 'unknown'}`));
      }
    });

    child.on('error', (err) => {
      process.off('SIGINT', signalHandler);
      process.off('SIGTERM', signalHandler);
      reject(err);
    });
  });
}
