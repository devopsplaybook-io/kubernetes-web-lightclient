import { createLoginCodeService } from "@devopsplaybook.io/common-web/services/LoginCodeService";
import { AuthService } from "~~/services/AuthService";

/**
 * Cross-device "login with a code" client. Requests use the shared axios
 * module under the app's `SERVER_URL` (/api), approvals carry the interactive
 * session, and a redeemed code installs the minted session before the card
 * reports the approval. Codes and tokens are never logged.
 */
export const loginCodeService = createLoginCodeService({
  getAuthHeader: () => AuthService.getAuthHeader(),
  onSession: async (token) => {
    await AuthService.saveToken(token);
  },
});

/** Only advertise the feature when the server enables it and the store is available. */
export async function loginCodesAvailable(): Promise<boolean> {
  try {
    const capabilities = await loginCodeService.capabilities();
    return capabilities.enabled === true && capabilities.available === true;
  } catch {
    return false;
  }
}
