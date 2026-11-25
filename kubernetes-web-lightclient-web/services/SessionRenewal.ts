// Sliding session: the shared common-web AuthService renews in the
// background when less than 20% of the token lifetime remains. This helper
// makes sure it is checked often enough: on app start, whenever the tab
// becomes visible or the window is focused, and on a periodic timer.
export const SESSION_RENEWAL_CHECK_INTERVAL_MS = 5 * 60 * 1_000;

/**
 * Run `renew` immediately, on visibilitychange/focus and on an interval.
 * Returns a stop function that removes every listener and the timer.
 */
export function SessionRenewalStart(
  renew: () => void | Promise<void>,
  intervalMs: number = SESSION_RENEWAL_CHECK_INTERVAL_MS,
): () => void {
  const run = (): void => {
    void renew();
  };
  const onVisibilityChange = (): void => {
    if (document.visibilityState === "visible") {
      run();
    }
  };

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("focus", run);
  const timer = setInterval(run, intervalMs);
  run();

  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("focus", run);
  };
}
