declare module "node:child_process" {
    export const spawnSync: any;
}

declare module "node:fs" {
    export const existsSync: any;
    export const mkdtempSync: any;
    export const readdirSync: any;
    export const readFileSync: any;
    export const rmSync: any;
    export const writeFileSync: any;
}

declare module "node:os" {
    export const tmpdir: any;
}

declare module "node:path" {
    export const join: any;
}

declare const Buffer: any;
declare const process: any;
