import axios from "axios";
import { AuthService } from "./AuthService";
import Config from "./Config";
import type { ListPreference } from "./ListTriage";

export interface ResourceType {
  id: string;
  name: string;
  namespaced: boolean;
  isCrd: boolean;
  group: string;
  deletable: boolean;
}

export class ResourceService {
  private static availableTypesPromise: Promise<ResourceType[]> | null = null;

  /**
   * Resource catalog, memoized for the palette and the details dialog. Pass
   * `force` when the caller needs the live catalog (e.g. after a CRD scan).
   */
  static async getAvailableTypes(
    force: boolean = false,
  ): Promise<ResourceType[]> {
    if (force) {
      ResourceService.availableTypesPromise = null;
    }
    if (!ResourceService.availableTypesPromise) {
      const request = (async () => {
        const response = await axios.get(
          `${(await Config.get()).SERVER_URL}/resources/types`,
          await AuthService.getAuthHeader(),
        );
        return response.data.types || [];
      })();
      ResourceService.availableTypesPromise = request.catch((error) => {
        ResourceService.availableTypesPromise = null;
        throw error;
      });
    }
    return ResourceService.availableTypesPromise;
  }

  /** Drop the memoized catalog (used by tests and after a forced refresh). */
  static clearAvailableTypesCache(): void {
    ResourceService.availableTypesPromise = null;
  }

  static async getUserSelections(): Promise<string[]> {
    const response = await axios.get(
      `${(await Config.get()).SERVER_URL}/resources/selections`,
      await AuthService.getAuthHeader(),
    );
    return response.data.selectedIds || [];
  }

  static async saveUserSelections(selectedIds: string[]): Promise<void> {
    await axios.put(
      `${(await Config.get()).SERVER_URL}/resources/selections`,
      { selectedIds },
      await AuthService.getAuthHeader(),
    );
  }

  static async getUserListPreferences(): Promise<
    Record<string, ListPreference>
  > {
    const response = await axios.get(
      `${(await Config.get()).SERVER_URL}/resources/selections`,
      await AuthService.getAuthHeader(),
    );
    return response.data.listPreferences || {};
  }

  static async saveUserListPreferences(
    listPreferences: Record<string, ListPreference>,
  ): Promise<void> {
    await axios.put(
      `${(await Config.get()).SERVER_URL}/resources/selections`,
      { listPreferences },
      await AuthService.getAuthHeader(),
    );
  }

  static async refreshTypes(): Promise<ResourceType[]> {
    const response = await axios.post(
      `${(await Config.get()).SERVER_URL}/resources/refresh`,
      {},
      await AuthService.getAuthHeader(),
    );
    return response.data.types || [];
  }

  static async getDataUrl(
    type: string,
    force: boolean = false,
  ): Promise<string> {
    const base = `${(await Config.get()).SERVER_URL}/resources/data/${type}`;
    return force ? `${base}?force=true` : base;
  }
}
