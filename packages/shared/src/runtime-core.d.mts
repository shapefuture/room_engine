export function runtimeProjection(cartridge: any): Array<{seq:number;p:number;t:number;r:number|null;text:string}>;
export function contentProjection(cartridge: any): any;
export function sha256Json(value: any): Promise<string>;
export function verifyCartridge(cartridge: any): Promise<boolean>;
export function bootCartridge(fetchImpl: typeof fetch): Promise<any>;
export function semanticGate(cartridge: any, integrityOK?: boolean): boolean;
export function doorUnlocked(cartridge: any, inventory: Set<string>, integrityOK?: boolean): boolean;
export function searchMessages(cartridge: any, query: string, tokensFn: (text:string)=>string[]): Array<{id:number;score:number}>;
