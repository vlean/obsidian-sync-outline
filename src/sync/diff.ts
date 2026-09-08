export type DiffKind = "same" | "added" | "removed";

export interface DiffLine {
	kind: DiffKind;
	text: string;
}

/**
 * Line diff via longest common subsequence.
 *
 * Only ever renders a conflict preview for one document, so the O(n*m)
 * table is fine; documents past the guard fall back to a summary.
 */
export function diffLines(before: string, after: string): DiffLine[] {
	const left = before.split("\n");
	const right = after.split("\n");

	if (left.length * right.length > 4_000_000) {
		return [
			{ kind: "removed", text: `(${left.length} lines in the local version)` },
			{ kind: "added", text: `(${right.length} lines in the Outline version)` },
		];
	}

	const lengths: number[][] = Array.from({ length: left.length + 1 }, () =>
		new Array<number>(right.length + 1).fill(0),
	);
	for (let i = left.length - 1; i >= 0; i--) {
		for (let j = right.length - 1; j >= 0; j--) {
			lengths[i][j] =
				left[i] === right[j]
					? lengths[i + 1][j + 1] + 1
					: Math.max(lengths[i + 1][j], lengths[i][j + 1]);
		}
	}

	const result: DiffLine[] = [];
	let i = 0;
	let j = 0;
	while (i < left.length && j < right.length) {
		if (left[i] === right[j]) {
			result.push({ kind: "same", text: left[i] });
			i++;
			j++;
		} else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
			result.push({ kind: "removed", text: left[i] });
			i++;
		} else {
			result.push({ kind: "added", text: right[j] });
			j++;
		}
	}
	while (i < left.length) result.push({ kind: "removed", text: left[i++] });
	while (j < right.length) result.push({ kind: "added", text: right[j++] });

	return result;
}

/** Collapses long runs of unchanged lines, the way a unified diff does. */
export function withContext(lines: DiffLine[], context = 3): DiffLine[] {
	const keep = new Set<number>();
	lines.forEach((line, index) => {
		if (line.kind === "same") return;
		for (let i = Math.max(0, index - context); i <= Math.min(lines.length - 1, index + context); i++) {
			keep.add(i);
		}
	});

	const result: DiffLine[] = [];
	let skipping = false;
	lines.forEach((line, index) => {
		if (keep.has(index)) {
			result.push(line);
			skipping = false;
		} else if (!skipping) {
			result.push({ kind: "same", text: "…" });
			skipping = true;
		}
	});
	return result;
}

export function countChanges(lines: DiffLine[]): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const line of lines) {
		if (line.kind === "added") added++;
		else if (line.kind === "removed") removed++;
	}
	return { added, removed };
}
