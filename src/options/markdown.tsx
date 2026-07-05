/**
 * Safe Markdown renderer for `analysisMarkdown` (MIK-022,
 * docs/ai-analysis-v2.md "UI behavior"). Renders through `react-markdown` +
 * `remark-gfm` only: no `rehype-raw` and no `dangerouslySetInnerHTML`, so raw
 * HTML in AI output stays inert — react-markdown emits it as literal text
 * instead of parsing it into DOM nodes. Every link opens in a new tab with
 * `rel="noreferrer"`.
 *
 * The component map gives the long-form Japanese research note an article feel
 * in the Warm Library / Deep Ledger direction: readable line height, gentle
 * borders for code/quotes/tables, restrained accent colors from the active
 * theme palette (docs/design.md "UI Design").
 */
import type { CSSProperties } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { type ThemePalette, useTheme } from "../lib/theme/index";

const monoStack =
	'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

function heading(fontSize: number): CSSProperties {
	return {
		fontSize,
		fontWeight: 700,
		lineHeight: 1.35,
		margin: "18px 0 6px",
	};
}

const tableScroll: CSSProperties = {
	overflowX: "auto",
	margin: "8px 0",
};

const tableStyle: CSSProperties = {
	borderCollapse: "collapse",
	fontSize: 12,
};

/**
 * Article-style element overrides for one theme palette. Each override drops
 * react-markdown's `node` AST prop so it never reaches the DOM.
 */
function createComponents(palette: ThemePalette): Components {
	const inlineCode: CSSProperties = {
		fontFamily: monoStack,
		fontSize: "0.9em",
		background: palette.paperInset,
		border: `1px solid ${palette.border}`,
		borderRadius: 4,
		padding: "0 4px",
	};

	const codeBlock: CSSProperties = {
		fontFamily: monoStack,
		fontSize: 12,
		lineHeight: 1.6,
		background: palette.paperInset,
		border: `1px solid ${palette.border}`,
		borderRadius: 8,
		padding: "10px 12px",
		margin: "8px 0",
		overflowX: "auto",
	};

	const tableCell: CSSProperties = {
		border: `1px solid ${palette.border}`,
		padding: "4px 8px",
		textAlign: "left",
	};

	return {
		h1: ({ node: _node, ...props }) => <h1 style={heading(18)} {...props} />,
		h2: ({ node: _node, ...props }) => <h2 style={heading(16)} {...props} />,
		h3: ({ node: _node, ...props }) => <h3 style={heading(14)} {...props} />,
		h4: ({ node: _node, ...props }) => <h4 style={heading(13)} {...props} />,
		h5: ({ node: _node, ...props }) => <h5 style={heading(13)} {...props} />,
		h6: ({ node: _node, ...props }) => <h6 style={heading(13)} {...props} />,
		p: ({ node: _node, ...props }) => (
			<p style={{ margin: "6px 0" }} {...props} />
		),
		ul: ({ node: _node, ...props }) => (
			<ul style={{ margin: "6px 0", paddingLeft: 22 }} {...props} />
		),
		ol: ({ node: _node, ...props }) => (
			<ol style={{ margin: "6px 0", paddingLeft: 22 }} {...props} />
		),
		li: ({ node: _node, ...props }) => (
			<li style={{ margin: "2px 0" }} {...props} />
		),
		blockquote: ({ node: _node, ...props }) => (
			<blockquote
				style={{
					margin: "8px 0",
					padding: "2px 12px",
					borderLeft: `3px solid ${palette.borderStrong}`,
					color: palette.inkSoft,
				}}
				{...props}
			/>
		),
		code: ({ node: _node, ...props }) => <code style={inlineCode} {...props} />,
		pre: ({ node: _node, ...props }) => <pre style={codeBlock} {...props} />,
		a: ({ node: _node, ...props }) => (
			<a
				style={{ color: palette.accent, wordBreak: "break-all" }}
				{...props}
				target="_blank"
				rel="noreferrer"
			/>
		),
		table: ({ node: _node, children, ...props }) => (
			<div style={tableScroll}>
				<table style={tableStyle} {...props}>
					{children}
				</table>
			</div>
		),
		th: ({ node: _node, ...props }) => (
			<th
				style={{
					...tableCell,
					background: palette.paperInset,
					fontWeight: 700,
				}}
				{...props}
			/>
		),
		td: ({ node: _node, ...props }) => <td style={tableCell} {...props} />,
		hr: ({ node: _node, ...props }) => (
			<hr
				style={{
					border: "none",
					borderTop: `1px solid ${palette.border}`,
					margin: "14px 0",
				}}
				{...props}
			/>
		),
	};
}

/** Per-palette cache: only the two shared palettes exist at runtime. */
const componentsCache = new Map<ThemePalette, Components>();

function componentsFor(palette: ThemePalette): Components {
	let components = componentsCache.get(palette);
	if (!components) {
		components = createComponents(palette);
		componentsCache.set(palette, components);
	}
	return components;
}

/** Render a long-form analysis note as a safe, readable Markdown article. */
export function AnalysisMarkdown({ markdown }: { markdown: string }) {
	const { palette } = useTheme();
	const article: CSSProperties = {
		fontSize: 13,
		lineHeight: 1.7,
		color: palette.ink,
		overflowWrap: "break-word",
	};
	return (
		<div style={article}>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={componentsFor(palette)}
			>
				{markdown}
			</ReactMarkdown>
		</div>
	);
}
