#!/usr/bin/env node
/**
 * Static link/path sanity check for the public GitHub Pages site (site/).
 *
 * - Scans site/**\/*.html for href/src attribute values.
 * - Flags empty href/src values.
 * - Flags root-absolute paths ("/...") because the site is served from a
 *   GitHub Pages project path (/bookmark-ai-extension/), where they break.
 * - Verifies that relative targets exist on disk (directory links resolve
 *   to their index.html).
 *
 * No dependencies. Run with: node scripts/check-site-links.mjs
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const siteDir = path.join(repoRoot, "site");

/** Recursively collect .html files under a directory. */
function collectHtmlFiles(dir) {
	const files = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectHtmlFiles(full));
		} else if (entry.isFile() && entry.name.endsWith(".html")) {
			files.push(full);
		}
	}
	return files;
}

/** Extract href/src attribute values with their attribute names. */
function extractReferences(html) {
	const refs = [];
	const pattern = /\b(href|src)\s*=\s*("([^"]*)"|'([^']*)')/gi;
	for (const match of html.matchAll(pattern)) {
		refs.push({
			attribute: match[1].toLowerCase(),
			value: match[3] ?? match[4] ?? "",
		});
	}
	return refs;
}

function isExternal(value) {
	return (
		/^[a-z][a-z0-9+.-]*:/i.test(value) || // http:, https:, mailto:, data:, …
		value.startsWith("//")
	);
}

function checkFile(htmlFile, problems) {
	const html = readFileSync(htmlFile, "utf8");
	const fileLabel = path.relative(repoRoot, htmlFile);

	for (const { attribute, value } of extractReferences(html)) {
		if (value.trim() === "") {
			problems.push(`${fileLabel}: empty ${attribute} attribute`);
			continue;
		}
		if (isExternal(value)) continue;
		if (value.startsWith("#")) continue;
		if (value.startsWith("/")) {
			problems.push(
				`${fileLabel}: root-absolute ${attribute}="${value}" breaks under the GitHub Pages project path`,
			);
			continue;
		}

		const targetPath = value.split("#")[0].split("?")[0];
		if (targetPath === "") continue; // pure fragment/query link

		let resolved = path.resolve(path.dirname(htmlFile), targetPath);
		try {
			if (statSync(resolved).isDirectory()) {
				resolved = path.join(resolved, "index.html");
				statSync(resolved);
			}
		} catch {
			problems.push(
				`${fileLabel}: ${attribute}="${value}" does not resolve to a file on disk`,
			);
			continue;
		}
		if (!resolved.startsWith(siteDir + path.sep) && resolved !== siteDir) {
			problems.push(
				`${fileLabel}: ${attribute}="${value}" escapes the site/ directory`,
			);
		}
	}
}

function main() {
	let htmlFiles;
	try {
		htmlFiles = collectHtmlFiles(siteDir);
	} catch {
		console.error(`check-site-links: site directory not found: ${siteDir}`);
		process.exit(1);
	}
	if (htmlFiles.length === 0) {
		console.error("check-site-links: no HTML files found under site/");
		process.exit(1);
	}

	const problems = [];
	for (const htmlFile of htmlFiles) {
		checkFile(htmlFile, problems);
	}

	if (problems.length > 0) {
		console.error(`check-site-links: ${problems.length} problem(s) found`);
		for (const problem of problems) {
			console.error(`  - ${problem}`);
		}
		process.exit(1);
	}
	console.log(
		`check-site-links: OK (${htmlFiles.length} HTML file(s) checked)`,
	);
}

main();
