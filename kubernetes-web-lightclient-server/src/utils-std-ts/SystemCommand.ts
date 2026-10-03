import * as childProcess from "child_process";

export interface SystemCommandOptions {
  timeout?: number;
  maxBuffer?: number;
}

/**
 * Execute a command without a shell. The command and its arguments are passed
 * as an argument vector so no shell metacharacter interpretation can occur.
 */
export function SystemCommandExecute(
  command: string,
  args: string[] = [],
  options: SystemCommandOptions = {},
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    childProcess.execFile(
      command,
      args,
      {
        timeout: options.timeout ?? 0,
        maxBuffer: options.maxBuffer ?? 1024 * 1024 * 10,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout);
        }
      },
    );
  });
}
