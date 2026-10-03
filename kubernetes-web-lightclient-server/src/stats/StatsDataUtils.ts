import { SystemCommandExecute } from "../utils-std-ts/SystemCommand";

/**
 * Run kubectl with an argument vector (no shell) and return the raw stdout.
 */
export async function kubernetesCommand(args: string[]): Promise<string> {
  return SystemCommandExecute("kubectl", args, {
    timeout: 20000,
    maxBuffer: 1024 * 1024 * 10,
  });
}
