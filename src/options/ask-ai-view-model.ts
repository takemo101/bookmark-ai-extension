/**
 * The Ask AI screen controller (MIK-045): a framework-agnostic state machine
 * holding the ephemeral chat-input state the "Ask AI" / "AIに聞く" options
 * screen renders. Chat state is in-memory only — nothing here touches Drive,
 * `chrome.storage.local`, or the Prompt API (MIK-042 design: chat history is
 * never persisted), so the whole conversation vanishes with the page.
 *
 * This slice is the screen shell: {@link AskAiController.submit} is
 * intentionally inert. The integration slice will route it through the Ask AI
 * use case (local candidate scoring → Prompt API reranking) and drive
 * {@link AskAiView.answering}; the view already carries the flag so the
 * component's disabled/`aria-busy` handling is in place.
 *
 * Observable via `subscribe`/`getView` exactly like `OptionsController` and
 * `SkillsController`, so React binds it with `useSyncExternalStore`.
 */
import { DEFAULT_ASK_AI_MIN_QUESTION_LENGTH } from "../lib/bookmarks/index";

/** The immutable snapshot the Ask AI screen renders. */
export type AskAiView = {
	/** The draft question exactly as typed (trimming happens only for policy). */
	readonly question: string;
	/**
	 * Whether the question may be submitted: trimmed length meets the shared
	 * Ask AI minimum (the local candidate scorer's policy) and no answer is in
	 * flight.
	 */
	readonly canSubmit: boolean;
	/** Non-streaming answer-in-flight placeholder; always false in this slice. */
	readonly answering: boolean;
};

export interface AskAiController {
	getView(): AskAiView;
	subscribe(listener: () => void): () => void;
	setQuestion(value: string): void;
	/** Fill the input from a clicked example prompt. */
	useExample(example: string): void;
	/** Inert in this slice (MIK-045): no Prompt API call, no transcript yet. */
	submit(): void;
}

export function createAskAiController(): AskAiController {
	let question = "";
	// Stays false until the integration slice wires the Ask AI use case.
	const answering = false;

	const listeners = new Set<() => void>();

	function render(): AskAiView {
		return {
			question,
			canSubmit:
				!answering &&
				question.trim().length >= DEFAULT_ASK_AI_MIN_QUESTION_LENGTH,
			answering,
		};
	}

	let view = render();

	function notify(): void {
		view = render();
		for (const listener of listeners) {
			listener();
		}
	}

	return {
		getView() {
			return view;
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		setQuestion(value) {
			question = value;
			notify();
		},
		useExample(example) {
			question = example;
			notify();
		},
		submit() {
			// Shell slice: submission is wired to the recommendation use case in
			// the integration slice.
		},
	};
}
