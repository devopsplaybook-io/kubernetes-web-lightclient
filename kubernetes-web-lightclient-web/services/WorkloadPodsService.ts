/**
 * I/O for the workload -> pods drill-down. Everything goes through the
 * existing validated /api/kubectl routes: no new server surface, no direct
 * Kubernetes access.
 */
import axios from "axios";
import { AuthService } from "~~/services/AuthService";
import Config from "~~/services/Config";
import { UtilsDecompressData } from "~/services/Utils";
import {
  BuildPodSelector,
  PodWarningEvents,
  ResolveWorkloadPods,
  type WorkloadKind,
} from "~~/services/WorkloadPods";

function WorkloadError(error: unknown, fallback: string): Error {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const serverMessage = (error.response?.data as { error?: string })?.error;
    if (status === 404) {
      return new Error(
        "This workload no longer exists — it may have been deleted since the list was loaded.",
      );
    }
    if (status === 429) {
      return new Error("Server is busy, please retry in a moment.");
    }
    if (status === 400 && serverMessage) {
      return new Error(serverMessage);
    }
  }
  return new Error(fallback);
}

export async function PostKubectl(
  payload: Record<string, unknown>,
  fallback: string,
): Promise<any> {
  try {
    const response = await axios.post(
      `${(await Config.get()).SERVER_URL}/kubectl/command`,
      payload,
      await AuthService.getAuthHeader(),
    );
    return JSON.parse(await UtilsDecompressData(response.data.result));
  } catch (error) {
    throw WorkloadError(error, fallback);
  }
}

export async function GetList(object: string, namespace: string): Promise<any[]> {
  const result = await PostKubectl(
    { object, command: "get", namespace },
    `Failed to load ${object} objects.`,
  );
  return result.items || [];
}

export interface FetchWorkloadPodsResult {
  workload: any;
  pods: any[];
  strategy: "selector" | "owner";
  selector: string | null;
}

export async function FetchWorkloadPods(input: {
  kind: WorkloadKind;
  name: string;
  namespace: string;
}): Promise<FetchWorkloadPodsResult> {
  const { kind, name, namespace } = input;
  const workload = await PostKubectl(
    { object: kind, command: "get", namespace, argument: name },
    `Failed to load the ${kind}.`,
  );
  const selector = BuildPodSelector(workload);

  let pods: any[];
  let replicasets: any[] = [];
  let jobs: any[] = [];
  if (selector) {
    const selected = await PostKubectl(
      { object: "pod", command: "get", namespace, selector },
      "Failed to load the workload pods.",
    );
    pods = selected.items || [];
    if (pods.length === 0 && kind === "deployment") {
      replicasets = await GetList("replicaset", namespace);
    }
  } else {
    pods = await GetList("pod", namespace);
    if (kind === "cronjob") {
      jobs = await GetList("job", namespace);
    }
  }

  const resolved = ResolveWorkloadPods({
    kind,
    workload,
    pods,
    replicasets,
    jobs,
    forceOwner: pods.length === 0 && replicasets.length > 0,
  });
  return { workload, pods: resolved.pods, strategy: resolved.strategy, selector };
}

export async function FetchWarningEvents(
  namespace: string,
  podNames: string[],
): Promise<any[]> {
  if (!podNames || podNames.length === 0) {
    return [];
  }
  const events = await GetList("events", namespace);
  return PodWarningEvents(events, podNames);
}
