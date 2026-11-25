import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SESSION_RENEWAL_CHECK_INTERVAL_MS,
  SessionRenewalStart,
} from "~~/services/SessionRenewal";

describe("SessionRenewalStart", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renews immediately, on focus/visibility and on the interval", () => {
    const renew = vi.fn();
    const stop = SessionRenewalStart(renew);

    expect(renew).toHaveBeenCalledTimes(1); // app start

    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(renew).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(SESSION_RENEWAL_CHECK_INTERVAL_MS);
    expect(renew).toHaveBeenCalledTimes(4);

    stop();
  });

  it("stops every trigger when the returned function is called", () => {
    const renew = vi.fn();
    const stop = SessionRenewalStart(renew, 1_000);
    stop();
    renew.mockClear();

    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(10_000);

    expect(renew).not.toHaveBeenCalled();
  });
});
