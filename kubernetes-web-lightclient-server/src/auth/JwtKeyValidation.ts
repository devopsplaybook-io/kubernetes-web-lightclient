export const JWT_KEY_MIN_LENGTH = 32;

const INSECURE_JWT_KEYS = new Set([
  "dev",
  "development",
  "default",
  "test",
  "testing",
  "secret",
  "password",
  "changeme",
  "change-me",
  "change_me",
  "jwt",
  "jwtsecret",
  "jwt-secret",
  "jwt_secret",
  "kubernetes",
  "kubernetes-web-lightclient",
]);

/**
 * Fails fast on an unusable JWT signing key. Runs after AuthInit so a weak
 * value loaded from the database is rejected too. The configured key is
 * never interpolated into the error message.
 */
export function ValidateJwtKey(key: unknown): void {
  const value = typeof key === "string" ? key.trim() : "";
  if (value === "") {
    throw new Error(
      "JWT_KEY is empty after initialization; leave it empty to use the " +
        "database-managed key or set a random JWT_KEY of at least 32 characters",
    );
  }
  if (INSECURE_JWT_KEYS.has(value.toLowerCase())) {
    throw new Error(
      "JWT_KEY is a known insecure value; set a random JWT_KEY of at least " +
        "32 characters or leave it empty to use the database-managed key",
    );
  }
  if (value.length < JWT_KEY_MIN_LENGTH) {
    throw new Error(
      `JWT_KEY must be at least ${JWT_KEY_MIN_LENGTH} characters; generate one ` +
        "with `openssl rand -hex 32` or leave it empty to use the database-managed key",
    );
  }
}
