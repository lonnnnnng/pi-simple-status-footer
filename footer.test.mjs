import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { parseColor, visibleWidth } from "@earendil-works/pi-tui";
import extension from "./index.ts";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const brain = String.fromCodePoint(0xf09d1);
const cacheHit = String.fromCodePoint(0xf0aa9);
const lastRequest = String.fromCodePoint(0xf02da);
const toolCountIcon = String.fromCodePoint(0xf1064);
const pluginCountIcon = String.fromCodePoint(0xf03d7);
const robot = String.fromCodePoint(0xf167a);
const folder = String.fromCodePoint(0xf0256);
const contextIcon = String.fromCodePoint(0xf07af);
const tokenInput = String.fromCodePoint(0xf0737);
const tokenOutput = String.fromCodePoint(0xf072e);
const tokenTotal = String.fromCodePoint(0xf04a0);
const cacheRead = String.fromCodePoint(0xf163b);
const cacheWrite = String.fromCodePoint(0xf163e);

async function renderFooter(config, {
	width = 200,
	contextPercent = 20,
	contextTokens = 200,
	statuses = new Map(),
	toolCount = 4,
	pluginPackageCount = 2,
	costTotal = 0,
	entries,
	gitStatus = "",
	gitBranch = null,
	afterStart,
	isOAuth = false,
	isSubscription = false,
} = {}) {
	const dir = await mkdtemp(join(process.cwd(), ".footer-test-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	const handlers = new Map();
	const colors = [];
	let component;
	const pi = {
		on(event, handler) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		registerCommand() {},
		getThinkingLevel: () => "medium",
		getSettings: () => ({
			compaction: { enabled: true },
			packages: Array.from({ length: pluginPackageCount }, (_, index) => `npm:plugin-${index}`),
		}),
		getActiveTools: () => Array.from({ length: toolCount }, (_, index) => `tool-${index}`),
		exec: async () => ({ code: 0, stdout: gitStatus }),
	};
	const usage = {
		input: 100, output: 20, cacheRead: 400, cacheWrite: 0, totalTokens: 520,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: costTotal },
	};
	const context = {
		mode: "tui",
		model: { id: "model", provider: "provider" },
		thinkingLevel: "medium",
		modelRegistry: {
			isUsingOAuth: () => isOAuth,
			getProvider: () => ({ auth: { oauth: { isSubscription } } }),
		},
		getContextUsage: () => ({ tokens: contextPercent == null ? null : contextTokens, percent: contextPercent, contextWindow: 1000 }),
		sessionManager: {
			getSessionId: () => "test-session",
			getHeader: () => null,
			getCwd: () => dir,
			getSessionName: () => undefined,
			getEntries: () => entries ?? [{ type: "message", message: { role: "assistant", usage } }],
		},
		ui: {
			setFooter(factory) {
				const tui = { requestRender() {} };
				const theme = {
					fg: (color, text) => { colors.push({ color, text }); return text; },
					style: (text, style) => { colors.push({ color: style.fg, text }); return text; },
					bg: (_color, text) => text,
				};
				const footerData = {
					onBranchChange: () => () => {},
					getGitBranch: () => gitBranch,
					getExtensionStatuses: () => statuses,
				};
				component = factory(tui, theme, footerData);
			},
		},
	};

	try {
		if (config !== undefined) {
			await writeFile(join(dir, "simple-status-footer.json"), JSON.stringify(config));
		}
		extension(pi);
		for (const handler of handlers.get("session_start") ?? []) await handler({}, context);
		await afterStart?.({ context, handlers, render: () => component.render(width) });
		const rawRows = component.render(width);
		// Most assertions concern values, independent of configurable layout spacing.
		return { rows: rawRows.map(row => row.replace(/(\S) {2,}/g, "$1 ")), rawRows, colors };
	} finally {
		component?.dispose();
		for (const handler of handlers.get("session_shutdown") ?? []) await handler({}, context);
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		await rm(dir, { recursive: true, force: true });
	}
}

test("default footer renders the model and metric glyphs", async () => {
	const { rows } = await renderFooter();
	const rendered = rows.join(" ");
	assert.ok(rows[0].startsWith("  "));
	assert.ok(rendered.includes(`${robot} model (provider)`));
	assert.ok(rendered.includes(`${brain} medium`));
	assert.ok(rendered.includes(`${folder} `));
	assert.ok(rendered.includes(`${contextIcon} 200/1.0k 20.0% (auto)`));
	assert.ok(rendered.includes(`${tokenInput} 100 ${tokenOutput} 20`));
	assert.ok(rendered.includes(`${tokenTotal} 520`));
	assert.ok(rendered.includes(`${cacheHit} avg 80.0%`));
	assert.ok(rendered.includes(`${cacheRead} 400 ${cacheWrite} 0`));
	assert.ok(rendered.includes(`${lastRequest} ${tokenInput} 100 ${tokenOutput} 20 ${tokenTotal} 520 ${cacheRead} 400 ${cacheWrite} 0 ${cacheHit} 80.0%`));
});

test("wide footer keeps model and context on the first row and usage on the second", async () => {
	const { rows } = await renderFooter({ icons: "ascii" }, { width: 1000, gitBranch: "main", costTotal: 1 });
	assert.equal(rows.length, 2);
	assert.ok(rows[0].includes("model (provider)"));
	assert.ok(rows[0].includes("medium"));
	assert.ok(rows[0].includes("main +0 ~0 ?0"));
	assert.ok(rows[0].includes("200/1.0k 20.0% (auto)"));
	assert.ok(!rows[0].includes("↑"));
	assert.ok(rows[1].includes("Last L ↑ 100 ↓ 20 Σ 520 R 400 W 0 % 80.0%"));
	assert.ok(rows[1].includes("Total ↑ 100 ↓ 20"));
	assert.ok(rows[1].includes("% avg 80.0%"));
	assert.ok(rows[1].includes("$ 1.000"));
	assert.ok(!rows[1].includes("(auto)"));
});

test("usage row separates three groups and highlights labels and six metric types", async () => {
	const { rawRows, colors } = await renderFooter({ icons: "ascii", tokens: "#ffffff", cache: "#ffffff" }, { width: 1000, costTotal: 1 });
	assert.ok(rawRows[1].includes("↑ 100   ↓ 20   Σ 520   R 400   W 0"));
	assert.equal(rawRows[1].split("│").length - 1, 2);
	assert.ok(rawRows[1].includes("│   Total"));
	assert.ok(rawRows[1].includes("│   $ 1.000"));
	const palette = ["↑ 100", "↓ 20", "Σ 520", "R 400", "W 0", "% 80.0%"]
		.map(text => JSON.stringify(colors.find(item => item.text === text)?.color));
	assert.equal(new Set(palette).size, 6);
	const defaults = JSON.parse(await readFile(new URL("./footer-theme.default.json", import.meta.url), "utf8"));
	assert.deepEqual(colors.find(item => item.text === "Last ")?.color, parseColor(defaults.lastLabel));
	assert.deepEqual(colors.find(item => item.text === "Total ")?.color, parseColor(defaults.totalLabel));
	assert.notEqual(defaults.lastLabel, defaults.totalLabel);
	const context = (await renderFooter({ icons: "ascii" }, { contextTokens: 12345 })).rows[0];
	assert.ok(context.includes("12k/1.0k 20.0% (auto)"));
});

test("session totals, average hit rate, and last request stay independent", async () => {
	const makeUsage = ({ input, output, cacheRead, cacheWrite }) => ({
		input, output, cacheRead, cacheWrite,
		totalTokens: input + output + cacheRead + cacheWrite,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	});
	const entries = [
		{ type: "message", message: { role: "assistant", usage: makeUsage({ input: 100, output: 20, cacheRead: 400, cacheWrite: 0 }) } },
		{ type: "usage", kind: "cache_warm", usage: makeUsage({ input: 50, output: 10, cacheRead: 50, cacheWrite: 100 }) },
		{ type: "message", message: { role: "assistant", usage: makeUsage({ input: 30, output: 5, cacheRead: 70, cacheWrite: 50 }) } },
	];
	const { rows } = await renderFooter(undefined, { entries });
	const rendered = rows.join(" ");
	assert.ok(rendered.includes(`${tokenInput} 180 ${tokenOutput} 35`));
	assert.ok(rendered.includes(`${tokenTotal} 885`));
	assert.ok(rendered.includes(`${cacheRead} 520 ${cacheWrite} 150`));
	assert.ok(rendered.includes(`${cacheHit} avg 61.2%`));
	assert.ok(rendered.includes(`${lastRequest} ${tokenInput} 30 ${tokenOutput} 5 ${tokenTotal} 155 ${cacheRead} 70 ${cacheWrite} 50 ${cacheHit} 46.7%`));
});

test("last request token counts are exact integers without abbreviation", async () => {
	const usage = {
		input: 12345, output: 6789, cacheRead: 23456, cacheWrite: 1234,
		totalTokens: 43824,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	const entries = [{ type: "message", message: { role: "assistant", usage } }];
	const { rows } = await renderFooter(undefined, { entries });
	const rendered = rows.join(" ");
	assert.ok(rendered.includes(`${tokenInput} 12k ${tokenOutput} 6.8k`));
	assert.ok(rendered.includes(`${lastRequest} ${tokenInput} 12345 ${tokenOutput} 6789 ${tokenTotal} 43824 ${cacheRead} 23456 ${cacheWrite} 1234 ${cacheHit} 63.3%`));
});

function usageOf(input, output, cacheRead = 0, cacheWrite = 0, cost = 0) {
	return {
		input, output, cacheRead, cacheWrite,
		totalTokens: input + output + cacheRead + cacheWrite,
		cost: { input: cost, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
	};
}

test("all recorded usage categories contribute once and total tokens follow components", async () => {
	const assistant = { ...usageOf(100, 20, 400, 0, 0.1), totalTokens: 0, reasoning: 10 };
	const entries = [
		{ type: "message", message: { role: "assistant", usage: assistant } },
		{ type: "usage", usage: usageOf(50, 10, 0, 100, 0.2) },
		{ type: "message", message: { role: "toolResult", usage: usageOf(10, 5, 20, 0, 0.3) } },
		{ type: "message", message: { role: "toolResult" } },
		{ type: "compaction", usage: usageOf(30, 10, 50, 20, 0.4) },
		{ type: "branch_summary", usage: usageOf(5, 5, 0, 0, 0.5) },
		{ type: "compaction" },
	];
	const rendered = (await renderFooter(undefined, { entries })).rows.join(" ");
	assert.ok(rendered.includes(`${tokenInput} 195 ${tokenOutput} 50`));
	assert.ok(rendered.includes(`${tokenTotal} 835`));
	assert.ok(rendered.includes(`${cacheRead} 470 ${cacheWrite} 120`));
	assert.ok(rendered.includes(`${cacheHit} avg 59.9%`));
	assert.ok(rendered.includes("$ 1.500"));
	assert.ok(rendered.includes(`${lastRequest} ${tokenInput} 100 ${tokenOutput} 20 ${tokenTotal} 520`));
});

test("a complete miss after cached requests displays zero reads, writes, and hit rate", async () => {
	const entries = [
		{ type: "message", message: { role: "assistant", usage: usageOf(20, 10, 80) } },
		{ type: "message", message: { role: "assistant", usage: usageOf(100, 10) } },
	];
	const rendered = (await renderFooter(undefined, { entries })).rows.join(" ");
	assert.ok(rendered.includes(`${cacheHit} avg 40.0%`));
	assert.ok(rendered.includes(`${lastRequest} ${tokenInput} 100 ${tokenOutput} 10 ${tokenTotal} 110 ${cacheRead} 0 ${cacheWrite} 0 ${cacheHit} 0.0%`));
});

test("empty sessions and zero-token responses do not produce invalid percentages", async () => {
	const empty = (await renderFooter(undefined, { entries: [] })).rows.join(" ");
	assert.ok(!empty.includes(lastRequest));
	assert.ok(!empty.includes("avg"));
	const entries = [
		{ type: "message", message: { role: "assistant", usage: usageOf(0, 0, 80, 20) } },
		{ type: "message", message: { role: "assistant", usage: usageOf(0, 0) } },
	];
	const rendered = (await renderFooter(undefined, { entries })).rows.join(" ");
	assert.ok(rendered.includes(`${cacheHit} avg 80.0%`));
	assert.ok(!rendered.includes(`${lastRequest} ${cacheHit}`));
	assert.ok(!/NaN|Infinity/.test(rendered));
});

test("completed turns refresh the latest persisted request", async () => {
	const entries = [];
	await renderFooter(undefined, {
		entries,
		afterStart: async ({ context, handlers, render }) => {
			assert.ok(!render().join(" ").includes(lastRequest));
			entries.push({ type: "message", message: { role: "assistant", usage: usageOf(42, 8) } });
			assert.ok(handlers.has("turn_end"));
			for (const handler of handlers.get("turn_end")) await handler({}, context);
			assert.ok(render().join(" ").replace(/ +/g, " ").includes(`${lastRequest} ${tokenInput} 42 ${tokenOutput} 8 ${tokenTotal} 50`));
		},
	});
});

test("narrow terminals preserve every exact last-request metric by wrapping", async () => {
	const entries = [{ type: "message", message: { role: "assistant", usage: usageOf(12345, 6789, 23456, 1234) } }];
	const { rows } = await renderFooter({ icons: "ascii" }, { entries, width: 30 });
	for (const metric of ["L ↑ 12345", "L ↓ 6789", "L Σ 43824", "L R 23456", "L W 1234", "L % 63.3%"]) {
		assert.ok(rows.some(row => row.includes(metric)), metric);
	}
	assert.ok(rows.every(row => visibleWidth(row) <= 30));
});

test("real Pi compaction retains usage and refreshes unknown context", async () => {
	const manager = SessionManager.inMemory(process.cwd());
	const first = manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "answer" }], usage: usageOf(100, 20, 400), stopReason: "stop", timestamp: Date.now() });
	const entries = manager.getEntries();
	await renderFooter(undefined, {
		entries,
		afterStart: async ({ context, handlers, render }) => {
			context.sessionManager.getEntries = () => manager.getEntries();
			assert.ok(render().join(" ").includes(`${tokenTotal} 520`));
			manager.appendCompaction("summary", first, 520, undefined, false, usageOf(30, 10));
			context.getContextUsage = () => ({ percent: null, contextWindow: 1000 });
			assert.ok(handlers.has("session_compact"));
			for (const handler of handlers.get("session_compact")) await handler({}, context);
			const rendered = render().join(" ");
			assert.equal(manager.getEntries().filter(entry => entry.type === "message").length, 1);
			assert.ok(rendered.includes(`${tokenTotal} 560`));
			assert.ok(rendered.includes(`${contextIcon} ?/1.0k (auto)`));
		},
	});
});

test("Git status counts files, including mixed changes, conflicts and untracked files", async () => {
	const gitStatus = 'M  staged\n M unstaged\nMM mixed\nR  "old -> new"\n?? new\nUU conflicted\n!! ignored\n';
	const rendered = (await renderFooter(undefined, { gitStatus, gitBranch: "main" })).rows.join(" ");
	assert.ok(rendered.includes("main +4 ~3 ?1"));
});

test("cost separates the currency symbol from its amount", async () => {
	const { rows } = await renderFooter(undefined, { costTotal: 1.234 });
	assert.ok(rows.join(" ").includes("$ 1.234"));
});

test("OAuth alone is not treated as a subscription", async () => {
	const oauth = (await renderFooter(undefined, { costTotal: 1, isOAuth: true })).rows.join(" ");
	assert.ok(!oauth.includes("(sub)"));
	const subscription = (await renderFooter(undefined, { isOAuth: true, isSubscription: true })).rows.join(" ");
	assert.ok(subscription.includes("$ 0.000 (sub)"));
});

test("default palette is data-driven and user theme fields override it", async () => {
	const defaults = JSON.parse(await readFile(new URL("./footer-theme.default.json", import.meta.url), "utf8"));
	const baseline = (await renderFooter()).colors;
	assert.deepEqual(baseline.find(item => item.text === `${robot} model`)?.color, parseColor(defaults.model));
	const custom = (await renderFooter({ model: "#ff00aa" })).colors;
	assert.deepEqual(custom.find(item => item.text === `${robot} model`)?.color, parseColor("#ff00aa"));
	assert.deepEqual(custom.find(item => item.text === "(provider)")?.color, parseColor(defaults.provider));
});

test("example theme decodes and renders the same glyphs", async () => {
	const config = JSON.parse(await readFile(new URL("./footer-theme.example.json", import.meta.url), "utf8"));
	const codepoints = {
		model: 0xf167a, thinking: 0xf09d1, path: 0xf0256, context: 0xf07af,
		tokenInput: 0xf0737, tokenOutput: 0xf072e, tokenTotal: 0xf04a0, cacheRead: 0xf163b,
		cacheWrite: 0xf163e, cacheHit: 0xf0aa9, lastRequest: 0xf02da, toolCount: 0xf1064,
		pluginCount: 0xf03d7, gitBranch: 0xf126,
	};
	for (const [key, codepoint] of Object.entries(codepoints)) {
		assert.equal(config.icons[key].codePointAt(0), codepoint, key);
	}
	const { rows } = await renderFooter(config);
	const rendered = rows.join(" ");
	assert.ok(rendered.includes(`${robot} model (provider)`));
	assert.ok(rendered.includes(`${brain} medium`));
	assert.ok(rendered.includes(`${tokenTotal} 520`));
	assert.ok(rendered.includes(`${cacheHit} avg 80.0%`));
	assert.ok(rendered.includes(`${cacheRead} 400 ${cacheWrite} 0`));
	assert.ok(rendered.includes(`${lastRequest} ${tokenInput} 100 ${tokenOutput} 20 ${tokenTotal} 520 ${cacheRead} 400 ${cacheWrite} 0 ${cacheHit} 80.0%`));
});

test("ASCII mode and individual icon overrides remain available", async () => {
	const ascii = (await renderFooter({ icons: "ascii" })).rows.join(" ");
	assert.ok(ascii.includes("model (provider)"));
	assert.ok(ascii.includes("↑ 100 ↓ 20"));
	assert.ok(ascii.includes("Σ 520"));
	assert.ok(ascii.includes("R 400 W 0"));
	assert.ok(ascii.includes("% avg 80.0%"));
	assert.ok(ascii.includes("L ↑ 100 ↓ 20 Σ 520 R 400 W 0 % 80.0%"));
	assert.ok(!ascii.includes(robot));
	const custom = (await renderFooter({ icons: { model: "", thinking: "*", path: "@", context: "#" } })).rows.join(" ");
	assert.ok(custom.includes("model (provider)"));
	assert.ok(custom.includes("* medium"));
	assert.ok(custom.includes("@ "));
	assert.ok(custom.includes("# 200/1.0k 20.0% (auto)"));
	assert.ok(!custom.includes(robot));
});

test("padding applies to status rows and stays within terminal width", async () => {
	const statuses = new Map([["mcp", "MCP: connected"]]);
	const { rows } = await renderFooter(undefined, { width: 30, statuses });
	assert.ok(rows.every(row => row.startsWith("  ") && visibleWidth(row) <= 30));
	assert.ok(rows.some(row => row.includes("  MCP: connected")));
	assert.ok(rows.some(row => row.includes(`${toolCountIcon} Tools: 4`)));
	assert.ok(rows.some(row => row.includes(`${pluginCountIcon} Plugins: 2`)));
	const flush = await renderFooter({ paddingLeft: 0 }, { width: 30, statuses });
	assert.ok(flush.rows.some(row => row.startsWith("MCP: connected")));
	const narrow = await renderFooter({ paddingLeft: 8 }, { width: 1, statuses });
	assert.ok(narrow.rows.every(row => visibleWidth(row) <= 1));
});

test("MCP row shows active tool and configured plugin-package counts", async () => {
	const statuses = new Map([["mcp", "MCP: 1/2 servers, 3 tools"]]);
	const { rows } = await renderFooter(undefined, { statuses, toolCount: 7, pluginPackageCount: 5 });
	assert.ok(rows.includes(`  MCP: 1/2 servers, 3 tools │ ${toolCountIcon} Tools: 7 │ ${pluginCountIcon} Plugins: 5`));
});

test("context icon retains warning colors and displays unknown usage", async () => {
	const defaults = JSON.parse(await readFile(new URL("./footer-theme.default.json", import.meta.url), "utf8"));
	for (const [percent, color] of [[80, "warning"], [95, "error"], [null, parseColor(defaults.context)]]) {
		const { colors } = await renderFooter(undefined, { contextPercent: percent });
		assert.deepEqual(colors.find(item => item.text.startsWith(`${contextIcon} `))?.color, color);
	}
});
