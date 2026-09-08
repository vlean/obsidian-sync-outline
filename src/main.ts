import { Notice, Plugin, TFile, debounce } from "obsidian";

import { OutlineClient } from "./outline/client";
import { SyncEngine, type Conflict, type Resolution } from "./sync/engine";
import { isInsideFolder } from "./sync/paths";
import { SyncStateStore, emptyState } from "./sync/state";
import { DEFAULT_SETTINGS, type OutlineSyncSettings, type SyncState, type SyncSummary } from "./types";
import { ConflictModal } from "./ui/conflict-modal";
import { OutlineSyncSettingTab } from "./ui/settings-tab";

interface PersistedData {
	settings: OutlineSyncSettings;
	state: SyncState;
}

export default class OutlineSyncPlugin extends Plugin {
	settings: OutlineSyncSettings = { ...DEFAULT_SETTINGS };
	private state = new SyncStateStore();
	private engine?: SyncEngine;
	private statusBar?: HTMLElement;
	private pollHandle?: number;
	/** Notes edited locally and waiting for the debounce to expire. */
	private readonly pendingPushes = new Set<string>();

	async onload(): Promise<void> {
		await this.loadPersisted();
		this.addSettingTab(new OutlineSyncSettingTab(this.app, this));

		this.statusBar = this.addStatusBarItem();
		this.setStatus("Outline: idle");

		this.addRibbonIcon("refresh-cw", "Sync with Outline", () => void this.syncNow());

		this.addCommand({
			id: "sync-now",
			name: "Sync with Outline now",
			callback: () => void this.syncNow(),
		});
		this.addCommand({
			id: "push-active-note",
			name: "Push the active note to Outline",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!checking) void this.pushFile(file);
				return true;
			},
		});
		this.addCommand({
			id: "open-in-outline",
			name: "Open the active note in Outline",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				const record = file ? this.state.byPath(file.path) : undefined;
				if (!record || !this.settings.baseUrl) return false;
				if (!checking) window.open(`${this.settings.baseUrl}/doc/${record.documentId}`, "_blank");
				return true;
			},
		});

		this.registerVaultEvents();

		this.app.workspace.onLayoutReady(() => {
			this.restartPolling();
			if (this.settings.syncOnStartup && this.isConfigured()) void this.syncNow(true);
		});
	}

	onunload(): void {
		this.clearPolling();
	}

	private isConfigured(): boolean {
		return Boolean(this.settings.baseUrl && this.settings.apiToken && this.settings.mappings.length);
	}

	private getEngine(): SyncEngine {
		// Rebuilt on demand so a settings change takes effect without a reload.
		const client = new OutlineClient(this.settings.baseUrl, this.settings.apiToken);
		this.engine = new SyncEngine(
			this.app,
			client,
			this.state,
			this.settings,
			{
				resolveConflicts: (conflicts) => this.askAboutConflicts(conflicts),
				onStatus: (message) => this.setStatus(`Outline: ${message}`),
				onError: (message) => new Notice(message, 10_000),
			},
			() => this.savePersisted(),
		);
		return this.engine;
	}

	async syncNow(quiet = false): Promise<void> {
		if (!this.isConfigured()) {
			if (!quiet) new Notice("Outline Sync: set the URL, token and at least one folder in settings first.");
			return;
		}
		const engine = this.getEngine();
		if (engine.isRunning) return;

		this.setStatus("Outline: syncing…");
		try {
			const summary = await engine.syncAll();
			this.reportSummary(summary, quiet);
		} catch (error) {
			this.setStatus("Outline: failed", true);
			new Notice(`Outline sync failed: ${String(error)}`, 10_000);
			return;
		}
		this.setStatus(`Outline: synced ${timeOfDay()}`);
	}

	private async pushFile(file: TFile): Promise<void> {
		if (!this.isConfigured()) return;
		try {
			const outcome = await this.getEngine().pushNote(file);
			if (outcome === "pushed") this.setStatus(`Outline: pushed ${timeOfDay()}`);
			if (outcome === "skipped" && !this.state.byPath(file.path)) {
				// Not yet a document: a full sync is what creates it.
				await this.syncNow(true);
			}
		} catch (error) {
			this.setStatus("Outline: push failed", true);
			new Notice(`Could not push ${file.basename}: ${String(error)}`, 10_000);
		}
	}

	private async askAboutConflicts(conflicts: Conflict[]): Promise<Map<string, Resolution>> {
		new Notice(
			`Outline Sync: ${conflicts.length} note(s) changed in both places.`,
			6000,
		);
		return new ConflictModal(this.app, conflicts).openAndWait();
	}

	private registerVaultEvents(): void {
		const flush = debounce(
			() => void this.flushPendingPushes(),
			this.settings.pushDebounceMs,
			true,
		);

		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (!(file instanceof TFile) || file.extension !== "md") return;
				if (!this.isTracked(file.path)) return;
				void this.queuePush(file, flush);
			}),
		);

		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (!(file instanceof TFile) || file.extension !== "md") return;
				if (!this.isTracked(file.path) || !this.settings.createRemoteForNewFiles) return;
				this.pendingPushes.add(file.path);
				flush();
			}),
		);

		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (!(file instanceof TFile)) return;
				const record = this.state.relocate(oldPath, file.path);
				if (!record) return;
				void this.savePersisted();
				// The title lives in the filename, so a rename is an edit.
				this.pendingPushes.add(file.path);
				flush();
			}),
		);

		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (!(file instanceof TFile)) return;
				const record = this.state.byPath(file.path);
				if (!record) return;
				if (this.settings.propagateLocalDeletes) {
					void this.deleteRemote(record.documentId, file.basename);
				}
				this.state.remove(record.documentId);
				void this.savePersisted();
			}),
		);
	}

	private async deleteRemote(documentId: string, title: string): Promise<void> {
		try {
			await new OutlineClient(this.settings.baseUrl, this.settings.apiToken).deleteDocument(documentId);
			new Notice(`Deleted "${title}" in Outline.`);
		} catch (error) {
			new Notice(`Could not delete "${title}" in Outline: ${String(error)}`, 10_000);
		}
	}

	private async queuePush(file: TFile, flush: () => void): Promise<void> {
		// Ignore the modify event our own pull just caused.
		const content = await this.app.vault.read(file);
		if (this.engine?.isSelfWrite(file.path, content)) return;
		this.pendingPushes.add(file.path);
		flush();
	}

	private async flushPendingPushes(): Promise<void> {
		if (!this.isConfigured()) return;
		const paths = [...this.pendingPushes];
		this.pendingPushes.clear();

		let needsFullSync = false;
		for (const path of paths) {
			const file = this.app.vault.getFileByPath(path);
			if (!file) continue;
			if (!this.state.byPath(path)) {
				needsFullSync = true;
				continue;
			}
			await this.pushFile(file);
		}
		if (needsFullSync) await this.syncNow(true);
	}

	private isTracked(path: string): boolean {
		return this.settings.mappings.some((mapping) => isInsideFolder(path, mapping.folder));
	}

	restartPolling(): void {
		this.clearPolling();
		const seconds = this.settings.pollIntervalSeconds;
		if (seconds <= 0) return;
		this.pollHandle = window.setInterval(() => {
			if (this.isConfigured()) void this.syncNow(true);
		}, seconds * 1000);
		this.registerInterval(this.pollHandle);
	}

	private clearPolling(): void {
		if (this.pollHandle !== undefined) {
			window.clearInterval(this.pollHandle);
			this.pollHandle = undefined;
		}
	}

	private reportSummary(summary: SyncSummary, quiet: boolean): void {
		const parts: string[] = [];
		if (summary.pulled) parts.push(`${summary.pulled} pulled`);
		if (summary.pushed) parts.push(`${summary.pushed} pushed`);
		if (summary.created) parts.push(`${summary.created} created`);
		if (summary.deleted) parts.push(`${summary.deleted} removed`);
		if (summary.conflicts > 0) parts.push(`${summary.conflicts} unresolved`);

		for (const error of summary.errors.slice(0, 3)) new Notice(`Outline Sync: ${error}`, 10_000);
		if (summary.errors.length > 3) {
			new Notice(`Outline Sync: ${summary.errors.length - 3} more problem(s).`, 8000);
		}
		if (parts.length > 0 && !quiet) new Notice(`Outline Sync: ${parts.join(", ")}.`);
		if (parts.length === 0 && !quiet) new Notice("Outline Sync: already up to date.");
	}

	private setStatus(message: string, isError = false): void {
		if (!this.statusBar) return;
		this.statusBar.setText(message);
		this.statusBar.toggleClass("outline-sync-status-error", isError);
	}

	private async loadPersisted(): Promise<void> {
		const data = (await this.loadData()) as Partial<PersistedData> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...(data?.settings ?? {}) };
		this.state = new SyncStateStore(data?.state);
	}

	async saveSettings(): Promise<void> {
		await this.savePersisted();
	}

	private async savePersisted(): Promise<void> {
		await this.saveData({ settings: this.settings, state: this.state.toJSON() } satisfies PersistedData);
	}

	async resetState(): Promise<void> {
		this.state = new SyncStateStore(emptyState());
		await this.savePersisted();
	}
}

function timeOfDay(): string {
	return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
