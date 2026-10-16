import axios from "axios";
import { AuthService } from "~~/services/AuthService";
import { AuthenticationStore } from "~~/stores/AuthenticationStore";

export const SESSION_EXPIRED_MESSAGE = "Session expired — please log in again";

interface SessionExpiryContext {
  router: { push: (location: unknown) => unknown };
  currentRoute: { path?: string; fullPath?: string };
}

/**
 * A return path is only followed when it is app-relative: it must start with
 * a single "/" and must not start with "//" or "/\" (protocol-relative or
 * scheme-spoofing open redirects).
 */
export function isSafeReturnPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.startsWith("/\\")
  );
}

/**
 * Handle a 401 raised mid-use: drop the dead token, flip the auth store so
 * the UI shows the login form, rewrite the error message to one clear
 * "session expired" wording for the caller's error handling, and route to
 * the login tab preserving the return URL. The error is always rethrown by
 * the caller so existing `.catch(handleError)` chains keep working.
 */
export async function handleSessionExpiryError(
  error: unknown,
  context: SessionExpiryContext,
): Promise<void> {
  if (!axios.isAxiosError(error) || error.response?.status !== 401) {
    return;
  }
  await AuthService.removeToken();
  AuthenticationStore().isAuthenticated = false;

  const data = error.response?.data;
  if (data && typeof data === "object") {
    (data as Record<string, unknown>).error = SESSION_EXPIRED_MESSAGE;
  }

  const currentPath = context.currentRoute?.path ?? "";
  if (currentPath !== "/settings") {
    context.router.push({
      path: "/settings",
      query: { tab: "profile", return: context.currentRoute?.fullPath ?? "/" },
    });
  }
}
