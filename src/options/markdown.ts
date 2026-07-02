/**
 * Minimal, dependency-free Markdown block parser for the options detail pane.
 *
 * Only recognizes headings and list items; everything else is a paragraph.
 * Deliberately does not parse or emit HTML — every block carries plain text,
 * so rendering it through React text children (never `dangerouslySetInnerHTML`)
 * escapes it by construction. This satisfies the "render analysisMarkdown
 * safely, raw HTML disabled/escaped" requirement (docs/ai-analysis-v2.md
 * "UI behavior") without adding a Markdown rendering dependency.
 */

export type MarkdownBlock =
	| { readonly type: "heading"; readonly level: number; readonly text: string }
	| { readonly type: "list-item"; readonly text: string }
	| { readonly type: "paragraph"; readonly text: string };

const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;
const LIST_ITEM_PATTERN = /^[-*]\s+(.*)$/;

/** Parse Markdown text into a flat, ordered list of display blocks. */
export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
	const blocks: MarkdownBlock[] = [];
	let paragraph: string[] = [];

	function flushParagraph(): void {
		if (paragraph.length > 0) {
			blocks.push({ type: "paragraph", text: paragraph.join(" ").trim() });
			paragraph = [];
		}
	}

	for (const rawLine of markdown.split("\n")) {
		const line = rawLine.trim();
		if (line.length === 0) {
			flushParagraph();
			continue;
		}

		const heading = HEADING_PATTERN.exec(line);
		if (heading) {
			flushParagraph();
			blocks.push({
				type: "heading",
				level: heading[1].length,
				text: heading[2].trim(),
			});
			continue;
		}

		const listItem = LIST_ITEM_PATTERN.exec(line);
		if (listItem) {
			flushParagraph();
			blocks.push({ type: "list-item", text: listItem[1].trim() });
			continue;
		}

		paragraph.push(line);
	}
	flushParagraph();

	return blocks;
}
