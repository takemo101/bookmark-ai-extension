const output = document.querySelector("#output");
const button = document.querySelector("#run");

function log(label, value) {
	const text =
		value === undefined ? label : `${label} ${JSON.stringify(value, null, 2)}`;
	console.log(label, value ?? "");
	output.textContent += `${text}\n`;
}

async function runForLanguage(language) {
	const opts = {
		expectedOutputs: [{ type: "text", languages: [language] }],
	};

	log(`\n=== ${language} ===`);
	const availability = await LanguageModel.availability(opts);
	log("availability", availability);

	const startedAt = Date.now();
	const session = await LanguageModel.create({
		...opts,
		monitor(monitor) {
			log("monitor attached");
			monitor.addEventListener("downloadprogress", (event) => {
				const loaded = event.loaded;
				const total = event.total;
				const ratio =
					typeof total === "number" && total > 0 ? loaded / total : loaded;
				log("downloadprogress", {
					elapsedMs: Date.now() - startedAt,
					loaded,
					total,
					ratio,
				});
			});
		},
	});

	log("session created", { elapsedMs: Date.now() - startedAt });
	session.destroy?.();
	log("session destroyed");
}

button.addEventListener("click", async () => {
	button.disabled = true;
	output.textContent = "";
	try {
		if (!("LanguageModel" in globalThis)) {
			log("LanguageModel is not present on globalThis");
			return;
		}
		await runForLanguage("ja");
		await runForLanguage("en");
		log("\nDone.");
	} catch (error) {
		log("debug failed", {
			name: error?.name,
			message: error?.message,
		});
	} finally {
		button.disabled = false;
	}
});
