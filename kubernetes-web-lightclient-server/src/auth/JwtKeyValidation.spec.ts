import { JWT_KEY_MIN_LENGTH, ValidateJwtKey } from "./JwtKeyValidation";

describe("ValidateJwtKey", () => {
  test.each([
    ["empty", ""],
    ["whitespace", "   "],
    ["undefined", undefined],
    ["null", null],
    ["dev", "dev"],
    ["DEV", "DEV"],
    ["development", "development"],
    ["default", "default"],
    ["test", "test"],
    ["secret", "secret"],
    ["jwt_secret", "jwt_secret"],
    ["kubernetes", "kubernetes"],
    ["kubernetes-web-lightclient", "kubernetes-web-lightclient"],
  ])("rejects %s", (_name, value) => {
    expect(() => ValidateJwtKey(value)).toThrow();
  });

  test("rejects a key shorter than the minimum length", () => {
    expect(() => ValidateJwtKey("a".repeat(JWT_KEY_MIN_LENGTH - 1))).toThrow(
      new RegExp(`at least ${JWT_KEY_MIN_LENGTH} characters`),
    );
  });

  test("accepts a 36-character database-managed key", () => {
    expect(() =>
      ValidateJwtKey("f47ac10b-58cc-4372-a567-0e02b2c3d479"),
    ).not.toThrow();
  });

  test("accepts a random key of exactly the minimum length", () => {
    expect(() => ValidateJwtKey("a".repeat(JWT_KEY_MIN_LENGTH))).not.toThrow();
  });

  test("never includes the configured key in the error message", () => {
    const weak = "dev";
    let message = "";
    try {
      ValidateJwtKey(weak);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain(weak);
  });
});
