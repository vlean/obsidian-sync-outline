/* Read-only checks against a real Outline install.
   Run: OUTLINE_URL=... OUTLINE_API_TOKEN=... npm run test:live */
import assert from "node:assert/strict";

import { OutlineClient } from "../src/outline/client";

const baseUrl = process.env.OUTLINE_URL;
const token = process.env.OUTLINE_API_TOKEN;
if (!baseUrl || !token) {
	console.error("Set OUTLINE_URL and OUTLINE_API_TOKEN.");
	process.exit(1);
}

const client = new OutlineClient(baseUrl, token);

const me = await client.whoami();
assert.ok(me.name, "whoami should return a name");
console.log(`  authenticated as ${me.name} <${me.email}>${me.isAdmin ? " (admin)" : ""}`);

const collections = await client.listCollections();
assert.ok(Array.isArray(collections));
console.log(`  ${collections.length} collection(s): ${collections.map((c) => c.name).join(", ")}`);

let documentCount = 0;
for (const collection of collections) {
	const documents = await client.listDocuments(collection.id);
	documentCount += documents.length;
	for (const document of documents) {
		assert.ok(document.id, "document id");
		assert.equal(typeof document.revision, "number", `revision on "${document.title}"`);
		assert.equal(typeof document.text, "string", `text on "${document.title}"`);
		assert.ok(document.updatedAt, "updatedAt");
	}
}
console.log(`  ${documentCount} document(s), all carrying revision + text`);

const [first] = await client.listDocuments(collections[0]?.id ?? "");
if (first) {
	const fetched = await client.getDocument(first.id);
	assert.equal(fetched?.id, first.id);
	assert.equal(fetched?.revision, first.revision, "documents.info and documents.list agree on revision");
	console.log(`  documents.info matches documents.list on "${first.title}" (revision ${first.revision})`);
}

const missing = await client.getDocument("00000000-0000-4000-8000-000000000000");
assert.equal(missing, undefined, "a missing document should be undefined, not an exception");
console.log("  missing documents resolve to undefined");

console.log("live checks passed");
