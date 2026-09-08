import { Modal, Setting, type App } from "obsidian";

import { countChanges, diffLines, withContext } from "../sync/diff";
import type { Conflict, Resolution } from "../sync/engine";

/**
 * Asks which version wins, one document at a time.
 *
 * Resolves with a decision for every conflict it was given; anything the
 * user dismisses without answering stays "skip", which leaves both copies
 * untouched and raises the same question on the next sync.
 */
export class ConflictModal extends Modal {
	private index = 0;
	private readonly decisions = new Map<string, Resolution>();
	private applyToAll = false;
	private resolve!: (decisions: Map<string, Resolution>) => void;

	constructor(
		app: App,
		private readonly conflicts: Conflict[],
	) {
		super(app);
	}

	openAndWait(): Promise<Map<string, Resolution>> {
		return new Promise((resolve) => {
			this.resolve = resolve;
			this.open();
		});
	}

	onOpen(): void {
		this.modalEl.addClass("outline-sync-conflict-modal");
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
		this.resolve(this.decisions);
	}

	private render(): void {
		const conflict = this.conflicts[this.index];
		if (!conflict) {
			this.close();
			return;
		}

		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: conflict.record.title || conflict.path });
		const position = contentEl.createDiv({ cls: "outline-sync-position" });
		position.setText(
			this.conflicts.length > 1
				? `Conflict ${this.index + 1} of ${this.conflicts.length} · ${conflict.path}`
				: conflict.path,
		);

		const editor = conflict.remote.updatedBy?.name;
		const when = new Date(conflict.remote.updatedAt).toLocaleString();
		contentEl.createDiv({ cls: "outline-sync-subtle" }).setText(
			`Both versions changed since the last sync. Outline is at revision ${conflict.remote.revision}` +
				`${editor ? `, last edited by ${editor}` : ""} on ${when}.`,
		);

		const lines = withContext(diffLines(conflict.localBody, conflict.remoteBody));
		const changes = countChanges(lines);
		contentEl.createDiv({ cls: "outline-sync-subtle" }).setText(
			`${changes.removed} line(s) only in your version, ${changes.added} only in Outline's.`,
		);

		const diff = contentEl.createDiv({ cls: "outline-sync-diff" });
		for (const line of lines) {
			const row = diff.createDiv({ cls: `outline-sync-line outline-sync-${line.kind}` });
			const marker = line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " ";
			row.createSpan({ cls: "outline-sync-marker", text: marker });
			row.createSpan({ text: line.text || " " });
		}

		const legend = contentEl.createDiv({ cls: "outline-sync-subtle" });
		legend.createSpan({ cls: "outline-sync-swatch outline-sync-removed-swatch" });
		legend.createSpan({ text: " your local note   " });
		legend.createSpan({ cls: "outline-sync-swatch outline-sync-added-swatch" });
		legend.createSpan({ text: " the version in Outline" });

		new Setting(contentEl)
			.setName("Which version should win?")
			.addButton((button) =>
				button
					.setButtonText("Keep local")
					.setTooltip("Overwrite the Outline document with this note")
					.onClick(() => this.decide("local")),
			)
			.addButton((button) =>
				button
					.setButtonText("Keep Outline")
					.setTooltip("Overwrite this note with the Outline document")
					.onClick(() => this.decide("remote")),
			)
			.addButton((button) =>
				button
					.setButtonText("Keep both")
					.setTooltip("Push this note, and save Outline's version as a separate note")
					.onClick(() => this.decide("both")),
			)
			.addButton((button) =>
				button.setButtonText("Decide later").onClick(() => this.decide("skip")),
			);

		if (this.conflicts.length > 1) {
			new Setting(contentEl)
				.setName("Apply to every remaining conflict")
				.setDesc("Use the next choice for all of them.")
				.addToggle((toggle) =>
					toggle.setValue(this.applyToAll).onChange((value) => {
						this.applyToAll = value;
					}),
				);
		}
	}

	private decide(resolution: Resolution): void {
		if (this.applyToAll) {
			for (let i = this.index; i < this.conflicts.length; i++) {
				this.decisions.set(this.conflicts[i].record.documentId, resolution);
			}
			this.close();
			return;
		}

		this.decisions.set(this.conflicts[this.index].record.documentId, resolution);
		this.index++;
		if (this.index >= this.conflicts.length) this.close();
		else this.render();
	}
}
