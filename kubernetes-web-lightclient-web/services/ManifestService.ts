import axios from "axios";
import Config from "~~/services/Config.ts";
import { AuthService } from "~~/services/AuthService";
import { UtilsDecompressData } from "~~/services/Utils";
import yaml from "js-yaml";

interface CommandPayload {
  object: string;
  command: string;
  argument?: string;
  namespace?: string;
  noJson?: boolean;
}

async function postCommand(payload: CommandPayload): Promise<string> {
  const res = await axios.post(
    `${(await Config.get()).SERVER_URL}/kubectl/command`,
    payload,
    await AuthService.getAuthHeader(),
  );
  return UtilsDecompressData(res.data.result);
}

export async function describeObject(
  objectType: string,
  namespace: string,
  objectName: string,
): Promise<string> {
  const payload: CommandPayload = {
    object: objectType,
    command: "describe",
    argument: objectName,
    noJson: true,
  };
  if (namespace) {
    payload.namespace = namespace;
  }
  return postCommand(payload);
}

export async function getObjectManifestYaml(
  objectType: string,
  namespace: string,
  objectName: string,
): Promise<string> {
  const payload: CommandPayload = {
    object: objectType,
    command: "get",
    argument: objectName,
  };
  if (namespace) {
    payload.namespace = namespace;
  }
  const json = JSON.parse(await postCommand(payload));
  return yaml.dump(json);
}
