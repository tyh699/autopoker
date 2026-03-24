import { randomUUID } from "node:crypto";

export function createId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function generateRoomCode(existing: Set<string>): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  while (true) {
    let code = "";
    for (let index = 0; index < 6; index += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    if (!existing.has(code)) {
      return code;
    }
  }
}

