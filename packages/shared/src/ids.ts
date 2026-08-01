import { v4 as uuidv4, parse as uuidParse, validate as uuidValidate } from "uuid";

export function newId(): string {
  return uuidv4();
}

export function isUuid(value: string): boolean {
  return uuidValidate(value);
}

export function parseUuid(value: string): Uint8Array {
  if (!uuidValidate(value)) {
    throw new Error("Invalid UUID");
  }
  return uuidParse(value);
}

export function uuidToBytes32(value: string): `0x${string}` {
  const bytes = parseUuid(value);
  const hex = Buffer.from(bytes).toString("hex");
  return `0x${hex.padStart(64, "0")}` as `0x${string}`;
}

export function shortId(value: string, length = 8): string {
  return value.replace(/-/g, "").slice(0, length);
}
