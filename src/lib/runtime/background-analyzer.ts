import {
	createChromePromptClient,
	createChromeSummarizerClient,
	type AnalysisOutcome,
} from "../ai/index";
import { type AnalyzerPort, createAnalyzerPort } from "../app/index";
import { createConsoleLogger } from "../logging/index";

/** One finite analysis attempt; no downloads or storage in the worker adapter. */
export function createBackgroundAnalyzer(
	create: (signal: AbortSignal) => AnalyzerPort = (signal) =>
		createAnalyzerPort(
			createChromePromptClient(undefined, { allowDownload: false, signal }),
			{
				summarizer: createChromeSummarizerClient(undefined, { signal }),
				logger: createConsoleLogger(),
			},
		),
	stopSignal?: AbortSignal,
): AnalyzerPort {
	return {
		async analyze(input, profiles, options) {
			const abort = new AbortController();
			const failed: AnalysisOutcome = {
				status: "failed",
				error: {
					kind: "client-error",
					message:
						"AI analysis could not complete. Save this page again to retry.",
				},
			};
			if (stopSignal?.aborted) return failed;
			let timer: ReturnType<typeof setTimeout> | undefined;
			let onStop: (() => void) | undefined;
			try {
				const stopped = new Promise<AnalysisOutcome>((resolve) => {
					onStop = () => {
						resolve(failed);
						abort.abort();
					};
					stopSignal?.addEventListener("abort", onStop, { once: true });
				});
				const deadline = new Promise<AnalysisOutcome>((resolve) => {
					timer = setTimeout(() => {
						resolve(failed);
						abort.abort();
					}, 180_000);
				});
				const result = await Promise.race([
					create(abort.signal).analyze(input, profiles, options),
					deadline,
					stopped,
				]);
				// Browser-generated errors may contain page content. Never persist them.
				return abort.signal.aborted || result.status === "failed"
					? failed
					: result;
			} catch {
				return failed;
			} finally {
				clearTimeout(timer);
				if (onStop) stopSignal?.removeEventListener("abort", onStop);
				abort.abort();
			}
		},
	};
}
