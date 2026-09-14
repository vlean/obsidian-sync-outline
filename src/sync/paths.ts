import type { RemoteDocument } from "../types";

/**
 * A folder in Obsidian has no content of its own, but Outline can only nest a
 * document under another document. So each Obsidian subfolder is represented by
 * a "folder placeholder" document whose only job is to be a parent. It is inert:
 * never written to a local note, and edits to it in Outline are ignored.
 *
 * The token appears both as visible text and inside an HTML comment, so a
 * document is still recognised even if Outline strips the comment on round-trip.
 */
export const FOLDER_MARKER = "outline-sync:folder";
export const FOLDER_PLACEHOLDER_BODY =
	`Folder placeholder · managed by Outline Sync · this document represents an Obsidian ` +
	`folder, and editing it here has no effect. <!--${FOLDER_MARKER}-->`;

/** True when a remote document is one of our folder placeholders. */
export function isFolderPlaceholder(text: string): boolean {
	return text.includes(FOLDER_MARKER);
}

/** Characters Obsidian (and the filesystems under it) refuse in a filename. */
const ILLEGAL = /[\\/:*?"<>|#^[\]]/g;

export function safeFileName(title: string): string {
	const cleaned = title
		.replace(ILLEGAL, "-")
		.replace(/\s+/g, " ")
		.replace(/^\.+/, "")
		.trim();
	// Titles can be long; Outline allows more than most filesystems do.
	const truncated = cleaned.length > 120 ? cleaned.slice(0, 120).trimEnd() : cleaned;
	return truncated || "Untitled";
}

/**
 * Where a document's note belongs.
 *
 * Nesting follows Obsidian's folder-note convention rather than index.md:
 * a document with children lives at "Parent.md" beside a "Parent/" folder
 * holding its children, so the file explorer reads the way the wiki does.
 */
export function pathForDocument(
	document: RemoteDocument,
	documentsById: Map<string, RemoteDocument>,
	rootFolder: string,
): string {
	const segments: string[] = [];
	let current: RemoteDocument | undefined = document;
	const seen = new Set<string>();

	while (current) {
		if (seen.has(current.id)) break; // defensive: a cycle would hang the sync
		seen.add(current.id);
		segments.unshift(safeFileName(current.title || "Untitled"));
		current = current.parentDocumentId ? documentsById.get(current.parentDocumentId) : undefined;
	}

	const folder = rootFolder.replace(/^\/+|\/+$/g, "");
	const relative = segments.join("/");
	return `${folder ? `${folder}/` : ""}${relative}.md`;
}

/** The folder that would hold this note's children. */
export function childFolderFor(notePath: string): string {
	return notePath.replace(/\.md$/, "");
}

export function parentFolderOf(path: string): string {
	const index = path.lastIndexOf("/");
	return index === -1 ? "" : path.slice(0, index);
}

export function isInsideFolder(path: string, folder: string): boolean {
	const normalized = folder.replace(/^\/+|\/+$/g, "");
	if (!normalized) return true;
	return path === normalized || path.startsWith(`${normalized}/`);
}

/** Title for a note that has never been to Outline: its filename. */
export function titleFromPath(path: string): string {
	const filename = path.split("/").pop() ?? path;
	return filename.replace(/\.md$/, "") || "Untitled";
}

/** Appends a suffix before the extension, e.g. "Note (conflict).md". */
export function withSuffix(path: string, suffix: string): string {
	return path.replace(/\.md$/, "") + suffix + ".md";
}
