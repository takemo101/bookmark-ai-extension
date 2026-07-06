// Prompt API model download debug snippet.
//
// Usage:
// 1. Open the extension popup.
// 2. Right-click the popup and choose Inspect.
// 3. Paste this whole file into the popup DevTools Console and press Enter.
// 4. Share the console output around availability/downloadprogress/error.
//
// This logs only Prompt API availability/progress/error metadata. It does not
// read page content, Drive data, OAuth tokens, or extension storage.

(async () => {
	const languages = ["ja", "en"];

	if (!("LanguageModel" in globalThis)) {
		console.log("LanguageModel is not present on globalThis");
		return;
	}

	for (const language of languages) {
		const opts = {
			expectedOutputs: [{ type: "text", languages: [language] }],
		};

		console.group(`Prompt API download debug: ${language}`);
		try {
			const availability = await LanguageModel.availability(opts);
			console.log("availability", availability);

			const session = await LanguageModel.create({
				...opts,
				monitor(monitor) {
					console.log("monitor attached", monitor);
					monitor.addEventListener("downloadprogress", (event) => {
						console.log("downloadprogress", {
							loaded: event.loaded,
							total: event.total,
							ratio:
								typeof event.total === "number" && event.total > 0
									? event.loaded / event.total
									: event.loaded,
						});
					});
				},
			});

			console.log("session created", session);
			session.destroy?.();
			console.log("session destroyed");
		} catch (error) {
			console.error("Prompt API debug failed", {
				name: error?.name,
				message: error?.message,
			});
		} finally {
			console.groupEnd();
		}
	}
})();
