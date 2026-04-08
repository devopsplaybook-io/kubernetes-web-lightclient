import { SystemCommandExecute } from "../utils-std-ts/SystemCommand";

export async function kubernetesCommand(command: string): Promise<string> {
  const commandOutput = await SystemCommandExecute(
    `${command} | gzip | base64 -w 0`,
    {
      timeout: 20000,
      maxBuffer: 1024 * 1024 * 10,
    },
  );
  const binaryString = atob(commandOutput);
  const byteArray = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    byteArray[i] = binaryString.charCodeAt(i);
  }
  const decompressionStream = new DecompressionStream("gzip");
  const readableStream = new ReadableStream({
    start(controller) {
      controller.enqueue(byteArray);
      controller.close();
    },
  });
  const response = new Response(
    readableStream.pipeThrough(decompressionStream),
  );
  const arrayBuffer = await response.arrayBuffer();
  return new TextDecoder().decode(arrayBuffer);
}
