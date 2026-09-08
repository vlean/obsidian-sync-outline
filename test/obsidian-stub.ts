/* Minimal stand-ins for the Obsidian runtime, for tests only. */
export class TFile {
	path = "";
	basename = "";
	extension = "md";
	name = "";
	parent: { path: string } | null = null;
	stat = { mtime: 0, ctime: 0, size: 0 };
}
export class TFolder {
	path = "";
}
export function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "");
}
export class Modal {}
export class Plugin {}
export class PluginSettingTab {}
export class Setting {}
export class Notice {}
export function debounce<T extends (...args: never[]) => unknown>(fn: T): T {
	return fn;
}
export function requestUrl(): never {
	throw new Error("requestUrl is not available in tests");
}
export type App = unknown;
