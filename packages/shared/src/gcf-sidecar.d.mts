export function mustQuoteCell(s: string): boolean;
export function quoted(s: string): string;
export function emitIndex(opts?: {
  stride?: number;
  sections?: Array<{ name: string; first: number; count: number; offset: number; t0: number; t1: number }>;
  anchors?: Array<{ m: number; offset: number; t: number }>;
}): string;
export function emitMap(opts: {
  sourceFile: string;
  sourceSha256: string;
  rows?: Array<{ m: number; tg: number; off: number; len: number; date: string }>;
  packRoot?: string;
}): string;
export function parseIndex(text: string): {
  stride: number;
  sections: Array<{ name: string; first: number; count: number; offset: number; t0: number; t1: number }>;
  anchors: Array<{ m: number; offset: number; t: number }>;
};
export function parseMap(text: string): {
  source: { file: string; sha256: string };
  rows: Array<{ m: number; tg: number; off: number; len: number; date: string }>;
  packRoot?: string;
};
export function compareBytes(a: Uint8Array, b: Uint8Array): number;
export function packRoot(rows: Array<{ m: number; tg: number; off: number; len: number; date: string }>): Promise<string>;
