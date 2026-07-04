/**
 * The custom-skill controller: a framework-agnostic state machine that turns
 * the {@link SkillsUseCases} boundary into an immutable {@link SkillsView} the
 * options page's "Analysis skills" panel renders (MIK-018,
 * docs/ai-analysis-v2.md "Settings file"). It owns every decision the panel
 * makes — the create/edit form draft, which skill is being edited, how to
 * phrase a safe action error — so the React layer stays a pure projection of
 * `getView()` and imports no Drive/settings-parse internals
 * (docs/implementation-principles.md "Tell, don't ask"; AGENTS.md
 * "Architecture boundaries").
 *
 * Built-in profiles (`ai/profile.ts`'s `BUILT_IN_PROFILES`) are shown for
 * display only — this module never re-implements or calls
 * `selectAnalysisProfile`; it only lists name/priority/urlPatterns for the
 * user's reference. They are never editable here.
 *
 * The controller is observable via {@link SkillsController.subscribe} /
 * {@link SkillsController.getView}, exactly like `OptionsController`, so React
 * can bind it with `useSyncExternalStore`.
 */
import { BUILT_IN_PROFILES } from "../lib/ai/index";
import type {
	CustomSkill,
	NewCustomSkillInput,
	SkillId,
} from "../lib/settings/index";
import type { SettingsCacheState, SkillsUseCases } from "./skills-use-cases";

export type BuiltInSkillView = {
	readonly id: string;
	readonly name: string;
	readonly priority: number;
	readonly urlPatterns: readonly string[];
};

export type CustomSkillRowView = {
	readonly id: string;
	readonly name: string;
	readonly enabled: boolean;
	readonly priority: number;
	readonly domains: readonly string[];
	readonly urlPatterns: readonly string[];
	readonly instruction: string;
	readonly updatedAt: string;
};

/** The create/edit form draft. Plain strings — comma/newline-separated lists
 * are split into `domains`/`urlPatterns` only on submit. */
export type SkillFormValues = {
	readonly name: string;
	readonly priority: string;
	readonly domains: string;
	readonly urlPatterns: string;
	readonly instruction: string;
};

const EMPTY_FORM: SkillFormValues = {
	name: "",
	priority: "10",
	domains: "",
	urlPatterns: "",
	instruction: "",
};

export type SkillsView = {
	readonly loading: boolean;
	readonly busy: boolean;
	readonly sync: {
		readonly status: string;
		readonly pendingLocalChanges: boolean;
	};
	readonly builtIns: readonly BuiltInSkillView[];
	readonly custom: readonly CustomSkillRowView[];
	/** `undefined` while creating a new skill; otherwise the id being edited. */
	readonly editingId?: string;
	/** Whether the create/edit form is open at all. */
	readonly formOpen: boolean;
	readonly form: SkillFormValues;
	readonly actionError?: string;
};

export interface SkillsController {
	getView(): SkillsView;
	subscribe(listener: () => void): () => void;
	init(): Promise<void>;
	refresh(): Promise<void>;
	startCreate(): void;
	startEdit(id: string): void;
	cancelEdit(): void;
	setFormField<K extends keyof SkillFormValues>(
		field: K,
		value: SkillFormValues[K],
	): void;
	submit(): Promise<void>;
	remove(id: string): Promise<void>;
	setEnabled(id: string, enabled: boolean): Promise<void>;
}

const BUILT_IN_VIEWS: readonly BuiltInSkillView[] = BUILT_IN_PROFILES.map(
	(profile) => ({
		id: profile.id,
		name: profile.name,
		priority: profile.priority,
		urlPatterns: profile.urlPatterns,
	}),
);

/** Split a comma/newline-separated list field into trimmed, non-empty entries. */
function splitList(value: string): string[] {
	return value
		.split(/[\n,]/)
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

function toRow(skill: CustomSkill): CustomSkillRowView {
	return {
		id: skill.id,
		name: skill.name,
		enabled: skill.enabled,
		priority: skill.priority,
		domains: skill.domains,
		urlPatterns: skill.urlPatterns,
		instruction: skill.instruction,
		updatedAt: skill.updatedAt,
	};
}

function toForm(skill: CustomSkill): SkillFormValues {
	return {
		name: skill.name,
		priority: String(skill.priority),
		domains: skill.domains.join(", "),
		urlPatterns: skill.urlPatterns.join(", "),
		instruction: skill.instruction,
	};
}

function safeMessage(message: string): string {
	const collapsed = message.replace(/\s+/g, " ").trim();
	return collapsed.length > 200 ? `${collapsed.slice(0, 197)}…` : collapsed;
}

export function createSkillsController(
	useCases: SkillsUseCases,
): SkillsController {
	let state: SettingsCacheState | undefined;
	let loading = true;
	let busy = false;
	let editingId: string | undefined;
	let formOpen = false;
	let form: SkillFormValues = EMPTY_FORM;
	let actionError: string | undefined;

	const listeners = new Set<() => void>();
	let idByDisplay = new Map<string, SkillId>();

	let view: SkillsView = render();

	function notify(): void {
		view = render();
		for (const listener of listeners) {
			listener();
		}
	}

	function setState(snapshot: SettingsCacheState): void {
		state = snapshot;
		const next = new Map<string, SkillId>();
		for (const skill of snapshot.settings.customSkills()) {
			next.set(skill.id, skill.id);
		}
		idByDisplay = next;
		if (editingId !== undefined && !idByDisplay.has(editingId)) {
			// The skill being edited is gone (e.g. deleted from another device).
			editingId = undefined;
			formOpen = false;
			form = EMPTY_FORM;
		}
	}

	function render(): SkillsView {
		return {
			loading,
			busy,
			sync: {
				status: state?.sync.status ?? "idle",
				pendingLocalChanges: state?.sync.pending === true,
			},
			builtIns: BUILT_IN_VIEWS,
			custom: state?.settings.customSkills().map(toRow) ?? [],
			editingId,
			formOpen,
			form,
			actionError,
		};
	}

	async function runAction(op: () => Promise<void>): Promise<void> {
		if (busy) {
			return;
		}
		busy = true;
		actionError = undefined;
		notify();
		try {
			await op();
		} finally {
			busy = false;
			notify();
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

		async init() {
			loading = true;
			notify();
			setState(await useCases.loadCachedSettings());
			loading = false;
			notify();
			await this.refresh();
		},

		async refresh() {
			await runAction(async () => {
				const result = await useCases.syncSettingsFromDrive();
				if (result.ok) {
					setState(result.value);
					return;
				}
				setState(await useCases.loadCachedSettings());
			});
		},

		startCreate() {
			editingId = undefined;
			formOpen = true;
			form = EMPTY_FORM;
			actionError = undefined;
			notify();
		},

		startEdit(id) {
			const branded = idByDisplay.get(id);
			const skill = branded ? state?.settings.get(branded) : undefined;
			if (!skill) {
				return;
			}
			editingId = id;
			formOpen = true;
			form = toForm(skill);
			actionError = undefined;
			notify();
		},

		cancelEdit() {
			editingId = undefined;
			formOpen = false;
			form = EMPTY_FORM;
			actionError = undefined;
			notify();
		},

		setFormField(field, value) {
			form = { ...form, [field]: value };
			notify();
		},

		async submit() {
			await runAction(async () => {
				const priority = Number.parseInt(form.priority, 10);
				const input: NewCustomSkillInput = {
					name: form.name,
					priority: Number.isFinite(priority) ? priority : undefined,
					domains: splitList(form.domains),
					urlPatterns: splitList(form.urlPatterns),
					instruction: form.instruction,
				};

				const branded = editingId ? idByDisplay.get(editingId) : undefined;
				const result =
					editingId !== undefined && branded
						? await useCases.updateSkill(branded, input)
						: await useCases.createSkill(input);

				if (!result.ok) {
					actionError = safeMessage(result.error.message);
					return;
				}
				setState(result.value);
				editingId = undefined;
				formOpen = false;
				form = EMPTY_FORM;
			});
		},

		async remove(id) {
			await runAction(async () => {
				const branded = idByDisplay.get(id);
				if (!branded) {
					return;
				}
				const result = await useCases.deleteSkill(branded);
				if (!result.ok) {
					actionError = safeMessage(result.error.message);
					return;
				}
				setState(result.value);
			});
		},

		async setEnabled(id, enabled) {
			await runAction(async () => {
				const branded = idByDisplay.get(id);
				if (!branded) {
					return;
				}
				const result = await useCases.setSkillEnabled(branded, enabled);
				if (!result.ok) {
					actionError = safeMessage(result.error.message);
					return;
				}
				setState(result.value);
			});
		},
	};
}
