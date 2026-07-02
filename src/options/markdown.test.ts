import { describe, expect, it } from "vitest";

import { parseMarkdownBlocks } from "./markdown";

describe("parseMarkdownBlocks", () => {
	it("parses headings, list items, and paragraphs", () => {
		const markdown = [
			"## このリポジトリは何か",
			"",
			"GitHub用のCLIツールです。",
			"",
			"- 特徴1",
			"- 特徴2",
		].join("\n");

		expect(parseMarkdownBlocks(markdown)).toEqual([
			{ type: "heading", level: 2, text: "このリポジトリは何か" },
			{ type: "paragraph", text: "GitHub用のCLIツールです。" },
			{ type: "list-item", text: "特徴1" },
			{ type: "list-item", text: "特徴2" },
		]);
	});

	it("joins consecutive non-blank lines into a single paragraph", () => {
		const markdown = ["一行目です。", "二行目です。"].join("\n");
		expect(parseMarkdownBlocks(markdown)).toEqual([
			{ type: "paragraph", text: "一行目です。 二行目です。" },
		]);
	});

	it("supports '*' list markers as well as '-'", () => {
		expect(parseMarkdownBlocks("* item")).toEqual([
			{ type: "list-item", text: "item" },
		]);
	});

	it("never emits raw HTML tags as anything other than literal text", () => {
		const markdown = "<script>alert(1)</script>";
		const blocks = parseMarkdownBlocks(markdown);
		expect(blocks).toEqual([
			{ type: "paragraph", text: "<script>alert(1)</script>" },
		]);
	});

	it("returns an empty array for blank input", () => {
		expect(parseMarkdownBlocks("   \n  \n")).toEqual([]);
	});
});
