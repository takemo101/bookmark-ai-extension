/**
 * Decorative site favicon for bookmark rows and detail headers (MIK-032).
 *
 * A thin projection of {@link faviconView}: renders the Chrome `_favicon`
 * endpoint image when the extension runtime resolves one, and the hostname
 * initial in a small tile otherwise — including when the image itself fails to
 * load. Purely decorative (`alt=""`, `aria-hidden`): every row/detail keeps
 * its accessible text, and no favicon data is stored anywhere. Shared with the
 * popup the same way `AnalysisMarkdown` is — a UI-only import with no
 * controller state.
 */
import type { CSSProperties } from "react";
import { useState } from "react";

import { faviconView } from "../lib/favicon/index";
import { palette } from "./styles";

function tileStyle(size: number): CSSProperties {
	return {
		boxSizing: "border-box",
		width: size,
		height: size,
		flexShrink: 0,
		display: "inline-flex",
		alignItems: "center",
		justifyContent: "center",
		fontSize: Math.round(size * 0.55),
		lineHeight: 1,
		color: palette.inkSoft,
		background: palette.paperInset,
		border: `1px solid ${palette.border}`,
		borderRadius: Math.max(4, Math.round(size / 6)),
		userSelect: "none",
	};
}

function imageStyle(size: number): CSSProperties {
	return {
		width: size,
		height: size,
		flexShrink: 0,
		borderRadius: Math.max(4, Math.round(size / 6)),
	};
}

/**
 * Key usages by the bookmark URL when the same component instance can switch
 * records in place (e.g. the detail sheet), so a failed load for one site
 * never leaves the next site stuck on the fallback.
 */
export function Favicon({ pageUrl, size }: { pageUrl: string; size: number }) {
	const [failed, setFailed] = useState(false);
	const view = faviconView(pageUrl, { size });
	if (!view.src || failed) {
		return (
			<span aria-hidden style={tileStyle(size)}>
				{view.fallback}
			</span>
		);
	}
	return (
		<img
			src={view.src}
			alt=""
			aria-hidden
			width={size}
			height={size}
			style={imageStyle(size)}
			onError={() => setFailed(true)}
		/>
	);
}
