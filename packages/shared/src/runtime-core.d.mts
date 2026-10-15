export function verifyCartridge(cartridge: any): Promise<boolean>;
export function buildShards(cartridge: any, rowsPerShard?: number): Promise<{core: any; shards: {file: string; text: string}[]}>;
export function bootCartridge(fetchImpl: typeof fetch, onProgress?: (p: {phase: string; done?: number; total?: number}) => void): Promise<any>;
export function semanticGate(cartridge: any, integrityOK?: boolean): boolean;
export function doorUnlocked(cartridge: any, inventory: Set<string>, integrityOK?: boolean): boolean;
export function searchMessages(cartridge: any, query: string, tokensFn: (text:string)=>string[]): Array<{id:number;score:number}>;
