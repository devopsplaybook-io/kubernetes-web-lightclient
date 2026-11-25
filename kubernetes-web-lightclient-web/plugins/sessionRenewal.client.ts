import { AuthService } from "~~/services/AuthService";
import { SessionRenewalStart } from "~~/services/SessionRenewal";

// Keeps the session sliding: AuthService renews once 20% of the token
// lifetime remains, so ask it for the token on start, on focus/visibility and
// periodically. A 401 anywhere is still handled by the axios interceptor.
export default defineNuxtPlugin(() => {
  SessionRenewalStart(() => AuthService.getToken());
});
