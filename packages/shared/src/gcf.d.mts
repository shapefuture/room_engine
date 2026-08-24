export function quoteScalar(value: unknown): string;
export function scalar(value: unknown): string;
export function encodeCanonicalMessages(messages: Array<{seq:number;p:number;t:number;r:number|null;text:string}>): string;
export function decodeCanonicalMessages(src: string): Array<{seq:number;p:number;t:number;r:number|null;text:string}>;
