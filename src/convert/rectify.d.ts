export type RectifyStats = { lines: number; before: number; after: number };
export function rectifyRGBA(cv: unknown, data: ArrayBuffer, width: number, height: number, post?: (stage: string) => void):
  Promise<{ data: ArrayBuffer; width: number; height: number; stats: RectifyStats; proj: { a: number; b: number } }>;
export function readyCv(mod: unknown): Promise<unknown>;
