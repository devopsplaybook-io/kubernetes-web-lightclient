import * as childProcess from "child_process";

export function SystemCommandExecute(command: string): Promise<string> {
  const exec = childProcess.exec;
  return new Promise<string>((resolve, reject) => {
    exec(command, (error, stdout) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout);
      }
    });
  });
}
