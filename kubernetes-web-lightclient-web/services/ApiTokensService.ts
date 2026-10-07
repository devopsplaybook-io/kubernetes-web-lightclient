import axios from "axios";
import { AuthService } from "./AuthService";
import Config from "./Config";

export interface ApiToken {
  id: string;
  name: string;
  dateCreated: string;
  expiresAt?: string | null;
  lastUsedAt?: string | null;
}

export interface ApiTokenCreated extends ApiToken {
  // Plaintext token value, returned by the server exactly once at creation.
  token: string;
}

export class ApiTokensService {
  static async list(): Promise<ApiToken[]> {
    const response = await axios.get(
      `${(await Config.get()).SERVER_URL}/users/tokens`,
      await AuthService.getAuthHeader(),
    );
    return response.data || [];
  }

  static async create(
    name: string,
    expiresAt?: string,
  ): Promise<ApiTokenCreated> {
    const payload: Record<string, string> = { name };
    if (expiresAt) {
      payload.expiresAt = expiresAt;
    }
    const response = await axios.post(
      `${(await Config.get()).SERVER_URL}/users/tokens`,
      payload,
      await AuthService.getAuthHeader(),
    );
    return response.data;
  }

  static async revoke(id: string): Promise<void> {
    await axios.delete(
      `${(await Config.get()).SERVER_URL}/users/tokens/${id}`,
      await AuthService.getAuthHeader(),
    );
  }
}
