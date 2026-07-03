import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AnalysisMarkdown } from "./markdown";

/**
 * The renderer is exercised through static server rendering: no DOM, Chrome,
 * or browser APIs. The assertions pin the MIK-022 safety contract — raw HTML
 * stays inert, links carry safe external-link attributes — plus the GFM
 * features the analysis notes rely on.
 */
function render(markdown: string): string {
	return renderToStaticMarkup(<AnalysisMarkdown markdown={markdown} />);
}

describe("AnalysisMarkdown", () => {
	it("renders headings, paragraphs, and lists as HTML elements", () => {
		const html = render(
			[
				"## このリポジトリは何か",
				"",
				"GitHub用のCLIツールです。",
				"",
				"- 特徴1",
				"- 特徴2",
			].join("\n"),
		);

		expect(html).toContain("<h2");
		expect(html).toContain("このリポジトリは何か");
		expect(html).toContain("<p");
		expect(html).toContain("GitHub用のCLIツールです。");
		expect(html).toContain("<ul");
		expect(html).toContain("<li");
		expect(html).toContain("特徴1");
	});

	it("keeps raw HTML in AI output inert (rendered as text, not markup)", () => {
		const html = render(
			'<script>alert("x")</script>\n\n<img src=x onerror=alert(1)>',
		);

		expect(html).not.toContain("<script");
		expect(html).not.toContain("<img");
		expect(html).toContain("&lt;script&gt;");
	});

	it("renders links with target=_blank and rel=noreferrer", () => {
		const html = render("[公式ドキュメント](https://example.test/docs)");

		expect(html).toContain('href="https://example.test/docs"');
		expect(html).toContain('target="_blank"');
		expect(html).toContain('rel="noreferrer"');
	});

	it("forces safe attributes even when a link override would be tempted otherwise", () => {
		// Autolinks via GFM go through the same `a` component override.
		const html = render("https://autolink.test/page");

		expect(html).toContain('href="https://autolink.test/page"');
		expect(html).toContain('target="_blank"');
		expect(html).toContain('rel="noreferrer"');
	});

	it("renders GFM tables", () => {
		const html = render(
			["| 項目 | 値 |", "| --- | --- |", "| 言語 | TypeScript |"].join("\n"),
		);

		expect(html).toContain("<table");
		expect(html).toContain("<th");
		expect(html).toContain("TypeScript");
	});

	it("renders GFM task lists as inert checkboxes", () => {
		const html = render(["- [x] 済み", "- [ ] 未対応"].join("\n"));

		expect(html).toContain('type="checkbox"');
		expect(html).toContain("disabled");
		expect(html).toContain("済み");
	});

	it("renders inline code and fenced code blocks", () => {
		const html = render(
			["`inline` code", "", "```", "const a = 1;", "```"].join("\n"),
		);

		expect(html).toContain("<code");
		expect(html).toContain("<pre");
		expect(html).toContain("const a = 1;");
	});
});
