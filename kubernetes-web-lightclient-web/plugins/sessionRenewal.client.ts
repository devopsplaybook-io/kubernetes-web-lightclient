import { AuthService } from "~~/services/AuthService";

// Keep the session sliding: AuthService renews once 20% of the token lifetime
// remains, and startSessionRenewal() checks it on start, on focus/visibility
// and every five minutes. A 401 anywhere is still handled by the interceptor.
export default defineNuxtPlugin(() => {
  AuthService.startSessionRenewal();
});
