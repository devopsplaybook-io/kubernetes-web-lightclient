// Mock for the ESM-only uuid package
// uuid v14+ is ESM-only which Jest/CJS cannot load
export const v1 = (): string => "00000000-0000-0000-0000-000000000001";
export const v3 = (): string => "00000000-0000-0000-0000-000000000003";
export const v4 = (): string => "00000000-0000-0000-0000-000000000004";
export const v5 = (): string => "00000000-0000-0000-0000-000000000005";
export const v6 = (): string => "00000000-0000-0000-0000-000000000006";
export const v7 = (): string => "00000000-0000-0000-0000-000000000007";
export const v1ToV6 = (): string => "00000000-0000-0000-0000-000000000006";
export const NIL = "00000000-0000-0000-0000-000000000000";
export const MAX = "ffffffff-ffff-ffff-ffff-ffffffffffff";
export const validate = (uuid: string): boolean =>
  typeof uuid === "string" && uuid.length === 36;
export const version = (_uuid: string): number => 4;
export const stringify = (buf: Uint8Array, offset?: number): string => {
  const bytes = Array.from(buf.slice(offset || 0, (offset || 0) + 16));
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
export const parse = (uuid: string): Uint8Array => {
  const hex = uuid.replace(/-/g, "");
  return new Uint8Array(hex.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) ?? []);
};
