import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const live = process.argv.includes("--live");
const out = mkdtempSync(join(tmpdir(), "outline-sync-tests-"));

const suites = live
	? [["live.test.ts", "obsidian-live-stub.ts"]]
	: [
			["pure.test.ts", "obsidian-stub.ts"],
			["engine.test.ts", "obsidian-stub.ts"],
		];

for (const [entry, stub] of suites) {
	const bundle = join(out, entry.replace(/\.ts$/, ".mjs"));
	execFileSync(
		"npx",
		[
			"esbuild",
			`test/${entry}`,
			"--bundle",
			"--platform=node",
			"--format=esm",
			`--alias:obsidian=./test/${stub}`,
			`--outfile=${bundle}`,
			"--log-level=error",
		],
		{ stdio: "inherit" },
	);
	console.log(`\n${entry}`);
	execFileSync("node", [bundle], { stdio: "inherit" });
}
