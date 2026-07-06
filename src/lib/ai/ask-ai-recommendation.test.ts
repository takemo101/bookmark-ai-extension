import { describe, expect, it } from "vitest";
import type { AskAiCandidate } from "../bookmarks/index";
import {
	MAX_ASK_AI_CANDIDATE_DESCRIPTION_CHARS,
	MAX_ASK_AI_CANDIDATE_TAGS,
	MAX_ASK_AI_CANDIDATE_TITLE_CHARS,
	MAX_ASK_AI_MESSAGE_CHARS,
	MAX_ASK_AI_PROMPT_CANDIDATES,
	MAX_ASK_AI_REASON_CHARS,
	MAX_ASK_AI_RECOMMENDATIONS,
	buildAskAiRecommendationPrompt,
	parseAskAiRecommendation,
} from "./ask-ai-recommendation";

function makeCandidate(
	overrides: Partial<AskAiCandidate> = {},
): AskAiCandidate {
	return {
		id: "id-1",
		canonicalUrl: "https://secret-host.example.com/private/path?q=1",
		url: "https://www.secret-host.example.com/private/path?q=1&utm=x",
		title: "TypeScript Handbook",
		domain: "example.com",
		description: "A guide to TypeScript.",
		genre: "Tech",
		tags: ["typescript", "guide"],
		aiStatus: "ready",
		score: 10,
		matchedFields: ["title"],
		fallbackReason: "Matched title",
		...overrides,
	};
}

function buildPrompt(
	candidates: readonly AskAiCandidate[],
	language: "en" | "ja" = "en",
	question = "What should I read about TypeScript?",
) {
	return buildAskAiRecommendationPrompt({ question, language, candidates });
}

describe("buildAskAiRecommendationPrompt", () => {
	it("includes only compact candidate fields in the payload", () => {
		const built = buildPrompt([makeCandidate()]);
		expect(built.candidatePayload).toHaveLength(1);
		const entry = built.candidatePayload[0];
		expect(entry).toEqual({
			id: "id-1",
			title: "TypeScript Handbook",
			domain: "example.com",
			genre: "Tech",
			tags: ["typescript", "guide"],
			description: "A guide to TypeScript.",
		});
	});

	it("omits optional genre and description when absent", () => {
		const built = buildPrompt([
			makeCandidate({ genre: undefined, description: undefined }),
		]);
		const entry = built.candidatePayload[0];
		expect(entry).not.toHaveProperty("genre");
		expect(entry).not.toHaveProperty("description");
	});

	it("excludes full URLs, canonical URLs, and non-compact fields from prompt and payload", () => {
		const built = buildPrompt([makeCandidate()]);
		const everything =
			built.prompt +
			built.systemInstruction +
			JSON.stringify(built.candidatePayload);
		expect(everything).not.toContain("secret-host.example.com");
		expect(everything).not.toContain("/private/path");
		expect(everything).not.toContain("canonicalUrl");
		expect(everything).not.toContain("analysisMarkdown");
		expect(everything).not.toContain("aiStatus");
		expect(everything).not.toContain("matchedFields");
		expect(everything).not.toContain("fallbackReason");
		expect(everything).not.toContain("Matched title");
	});

	it("caps the number of candidates in the payload", () => {
		const candidates = Array.from({ length: 60 }, (_, i) =>
			makeCandidate({ id: `id-${i}` }),
		);
		const built = buildPrompt(candidates);
		expect(built.candidatePayload).toHaveLength(MAX_ASK_AI_PROMPT_CANDIDATES);
		expect(built.candidatePayload[0]?.id).toBe("id-0");
	});

	it("supports a smaller candidate cap for quota retry prompts", () => {
		const candidates = Array.from({ length: 50 }, (_, i) =>
			makeCandidate({ id: `id-${i}` }),
		);
		const built = buildAskAiRecommendationPrompt({
			question: "typescript",
			language: "en",
			candidates,
			maxCandidates: 25,
		});

		expect(built.candidatePayload).toHaveLength(25);
		expect(built.candidatePayload.at(-1)?.id).toBe("id-24");
	});

	it("caps tags, description, and title per candidate", () => {
		expect(MAX_ASK_AI_CANDIDATE_TITLE_CHARS).toBe(96);
		expect(MAX_ASK_AI_CANDIDATE_DESCRIPTION_CHARS).toBe(120);
		const built = buildPrompt([
			makeCandidate({
				title: "t".repeat(500),
				description: "d".repeat(1000),
				tags: ["a", "b", "c", "d", "e", "f", "g", "h"],
			}),
		]);
		const entry = built.candidatePayload[0];
		expect(entry?.title).toHaveLength(MAX_ASK_AI_CANDIDATE_TITLE_CHARS);
		expect(entry?.description).toHaveLength(
			MAX_ASK_AI_CANDIDATE_DESCRIPTION_CHARS,
		);
		expect(entry?.tags).toHaveLength(MAX_ASK_AI_CANDIDATE_TAGS);
	});

	it("includes the user question and the candidate payload in the prompt", () => {
		const built = buildPrompt([makeCandidate()], "en", "find me cooking sites");
		expect(built.prompt).toContain("find me cooking sites");
		expect(built.prompt).toContain('"id-1"');
		expect(built.prompt).toContain("TypeScript Handbook");
	});

	it("instructs the model to answer in English for the en UI language", () => {
		const built = buildPrompt([makeCandidate()], "en");
		expect(built.systemInstruction).toContain("English");
		expect(built.prompt).toContain("English");
	});

	it("instructs the model to answer in Japanese for the ja UI language", () => {
		const built = buildPrompt([makeCandidate()], "ja");
		expect(built.systemInstruction).toContain("日本語");
		expect(built.prompt).toContain("日本語");
	});

	it("instructs the model to output JSON only, use candidate ids, and cap recommendations", () => {
		const built = buildPrompt([makeCandidate()], "en");
		expect(built.prompt).toContain("JSON");
		expect(built.prompt).toContain(String(MAX_ASK_AI_RECOMMENDATIONS));
		expect(built.prompt.toLowerCase()).toContain("id");
	});
});

const ALLOWED_IDS = ["id-1", "id-2", "id-3", "id-4", "id-5", "id-6", "id-7"];

function validOutput(
	recommendations: readonly { id: string; reason: string }[],
	message = "Here are some matches.",
): string {
	return JSON.stringify({ message, recommendations });
}

describe("parseAskAiRecommendation", () => {
	it("parses valid JSON output", () => {
		const raw = validOutput([
			{ id: "id-1", reason: "Matches your question." },
			{ id: "id-2", reason: "Also relevant." },
		]);
		const result = parseAskAiRecommendation(raw, ALLOWED_IDS);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.message).toBe("Here are some matches.");
			expect(result.value.recommendations).toEqual([
				{ id: "id-1", reason: "Matches your question." },
				{ id: "id-2", reason: "Also relevant." },
			]);
		}
	});

	it("parses JSON wrapped in code fences and prose", () => {
		const raw = `Sure! Here is the result:\n\`\`\`json\n${validOutput([
			{ id: "id-1", reason: "Relevant." },
		])}\n\`\`\`\nHope that helps.`;
		const result = parseAskAiRecommendation(raw, ALLOWED_IDS);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.recommendations).toEqual([
				{ id: "id-1", reason: "Relevant." },
			]);
		}
	});

	it("caps recommendations to 5", () => {
		const raw = validOutput(
			ALLOWED_IDS.map((id) => ({ id, reason: `Reason for ${id}` })),
		);
		const result = parseAskAiRecommendation(raw, ALLOWED_IDS);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.recommendations).toHaveLength(
				MAX_ASK_AI_RECOMMENDATIONS,
			);
			expect(result.value.recommendations.map((r) => r.id)).toEqual([
				"id-1",
				"id-2",
				"id-3",
				"id-4",
				"id-5",
			]);
		}
	});

	it("drops unknown candidate ids and keeps known ones", () => {
		const raw = validOutput([
			{ id: "unknown-1", reason: "Hallucinated." },
			{ id: "id-2", reason: "Real." },
			{ id: "unknown-2", reason: "Hallucinated too." },
		]);
		const result = parseAskAiRecommendation(raw, ALLOWED_IDS);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.recommendations).toEqual([
				{ id: "id-2", reason: "Real." },
			]);
		}
	});

	it("drops duplicate candidate ids", () => {
		const raw = validOutput([
			{ id: "id-1", reason: "First." },
			{ id: "id-1", reason: "Duplicate." },
		]);
		const result = parseAskAiRecommendation(raw, ALLOWED_IDS);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.recommendations).toEqual([
				{ id: "id-1", reason: "First." },
			]);
		}
	});

	it("skips malformed recommendation entries but keeps valid ones", () => {
		const raw = JSON.stringify({
			message: "ok",
			recommendations: [
				"not-an-object",
				{ reason: "missing id" },
				{ id: 42, reason: "non-string id" },
				{ id: "id-1", reason: 42 },
				{ id: "id-2", reason: "   " },
				{ id: "id-3", reason: "valid" },
			],
		});
		const result = parseAskAiRecommendation(raw, ALLOWED_IDS);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.recommendations).toEqual([
				{ id: "id-3", reason: "valid" },
			]);
		}
	});

	it("trims and caps message and reason", () => {
		const raw = validOutput(
			[{ id: "id-1", reason: `  ${"r".repeat(1000)}  ` }],
			`  ${"m".repeat(2000)}  `,
		);
		const result = parseAskAiRecommendation(raw, ALLOWED_IDS);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.message).toHaveLength(MAX_ASK_AI_MESSAGE_CHARS);
			expect(result.value.recommendations[0]?.reason).toHaveLength(
				MAX_ASK_AI_REASON_CHARS,
			);
		}
	});

	it("fails with empty-output for blank output", () => {
		const result = parseAskAiRecommendation("   ", ALLOWED_IDS);
		expect(result).toEqual({
			ok: false,
			error: expect.objectContaining({ kind: "empty-output" }),
		});
	});

	it("fails with invalid-field for non-string output", () => {
		const result = parseAskAiRecommendation(42, ALLOWED_IDS);
		expect(result).toEqual({
			ok: false,
			error: expect.objectContaining({ kind: "invalid-field" }),
		});
	});

	it("fails with no-json when output has no JSON object", () => {
		const result = parseAskAiRecommendation(
			"I could not find anything.",
			ALLOWED_IDS,
		);
		expect(result).toEqual({
			ok: false,
			error: expect.objectContaining({ kind: "no-json" }),
		});
	});

	it("fails with invalid-json for a malformed JSON object", () => {
		const result = parseAskAiRecommendation(
			'{ "message": , "recommendations": [] }',
			ALLOWED_IDS,
		);
		expect(result).toEqual({
			ok: false,
			error: expect.objectContaining({ kind: "invalid-json" }),
		});
	});

	it("fails with missing-field when message is missing", () => {
		const result = parseAskAiRecommendation(
			JSON.stringify({ recommendations: [{ id: "id-1", reason: "r" }] }),
			ALLOWED_IDS,
		);
		expect(result).toEqual({
			ok: false,
			error: expect.objectContaining({
				kind: "missing-field",
				field: "message",
			}),
		});
	});

	it("fails with missing-field when recommendations is missing", () => {
		const result = parseAskAiRecommendation(
			JSON.stringify({ message: "hello" }),
			ALLOWED_IDS,
		);
		expect(result).toEqual({
			ok: false,
			error: expect.objectContaining({
				kind: "missing-field",
				field: "recommendations",
			}),
		});
	});

	it("fails with invalid-field when recommendations is not an array", () => {
		const result = parseAskAiRecommendation(
			JSON.stringify({ message: "hello", recommendations: "id-1" }),
			ALLOWED_IDS,
		);
		expect(result).toEqual({
			ok: false,
			error: expect.objectContaining({
				kind: "invalid-field",
				field: "recommendations",
			}),
		});
	});

	it("fails with no-valid-recommendations when the list is empty", () => {
		const result = parseAskAiRecommendation(validOutput([]), ALLOWED_IDS);
		expect(result).toEqual({
			ok: false,
			error: expect.objectContaining({ kind: "no-valid-recommendations" }),
		});
	});

	it("fails with no-valid-recommendations when every id is unknown", () => {
		const raw = validOutput([
			{ id: "ghost-1", reason: "Hallucinated." },
			{ id: "ghost-2", reason: "Hallucinated." },
		]);
		const result = parseAskAiRecommendation(raw, ALLOWED_IDS);
		expect(result).toEqual({
			ok: false,
			error: expect.objectContaining({ kind: "no-valid-recommendations" }),
		});
	});

	it("fails with no-valid-recommendations when every reason is unusable", () => {
		const raw = JSON.stringify({
			message: "ok",
			recommendations: [
				{ id: "id-1", reason: "   " },
				{ id: "id-2", reason: 42 },
			],
		});
		const result = parseAskAiRecommendation(raw, ALLOWED_IDS);
		expect(result).toEqual({
			ok: false,
			error: expect.objectContaining({ kind: "no-valid-recommendations" }),
		});
	});
});
