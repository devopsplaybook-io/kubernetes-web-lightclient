import axios from "axios";
import { AuthService } from "./AuthService";
import Config from "./Config";

export interface ResourceType {
  id: string;
  name: string;
  namespaced: boolean;
  isCrd: boolean;
  group: string;
}

export class ResourceService {
  static async getAvailableTypes(): Promise<ResourceType[]> {
    const response = await axios.get(
      `${(await Config.get()).SERVER_URL}/resources/types`,
      await AuthService.getAuthHeader(),
    );
    return response.data.types || [];
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

  static async refreshTypes(): Promise<ResourceType[]> {
    const response = await axios.post(
      `${(await Config.get()).SERVER_URL}/resources/refresh`,
      {},
      await AuthService.getAuthHeader(),
    );
    return response.data.types || [];
  }
}
