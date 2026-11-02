import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { parseColor, visibleWidth } from "@earendil-works/pi-tui";
import extension from "./index.ts";

const brain = String.fromCodePoint(0xf09d1);
const cacheHit = String.fromCodePoint(0xf0aa9);
const toolCountIcon = String.fromCodePoint(0xf1064);
const pluginCountIcon = String.fromCodePoint(0xf03d7);
const robot = String.fromCodePoint(0xf167a);
const folder = String.fromCodePoint(0xf0256);
const contextIcon = String.fromCodePoint(0xf07af);
const tokenInput = String.fromCodePoint(0xf0737);
const tokenOutput = String.fromCodePoint(0xf072e);
const cacheRead = String.fromCodePoint(0xf163b);
const cacheWrite = String.fromCodePoint(0xf163e);
const timer = String.fromCodePoint(0xf051b);

async function renderFooter(config, {
	width = 200,
	contextPercent = 20,
	statuses = new Map(),
	toolCount = 4,
	pluginPackageCount = 2,
	costTotal = 0,
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
		exec: async () => ({ code: 0, stdout: "" }),
	};
	const usage = {
		input: 100, output: 20, cacheRead: 400, cacheWrite: 0, totalTokens: 520,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: costTotal },
	};
	const context = {
		mode: "tui",
		model: { id: "model", provider: "provider" },
		thinkingLevel: "medium",
		modelRegistry: { isUsingOAuth: () => false },
		getContextUsage: () => ({ percent: contextPercent, contextWindow: 1000 }),
		sessionManager: {
			getSessionId: () => "test-session",
			getHeader: () => null,
			getCwd: () => dir,
			getSessionName: () => undefined,
			getEntries: () => [{ type: "message", message: { role: "assistant", usage } }],
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
					getGitBranch: () => null,
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
		return { rows: component.render(width), colors };
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
	assert.ok(rendered.includes(`${contextIcon} 20.0%/1.0k (auto)`));
	assert.ok(rendered.includes(`${tokenInput} 100 ${tokenOutput} 20`));
	assert.ok(rendered.includes(`${cacheHit} 80.0%`));
	assert.ok(rendered.includes(`${cacheRead} 400 ${cacheWrite} 0`));
	assert.ok(rendered.includes(timer));
});

test("cost separates the currency symbol from its amount", async () => {
	const { rows } = await renderFooter(undefined, { costTotal: 1.234 });
	assert.ok(rows.join(" ").includes("$ 1.234"));
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
		tokenInput: 0xf0737, tokenOutput: 0xf072e, cacheRead: 0xf163b,
		cacheWrite: 0xf163e, cacheHit: 0xf0aa9, toolCount: 0xf1064,
		pluginCount: 0xf03d7, sessionTime: 0xf051b, gitBranch: 0xf126,
	};
	for (const [key, codepoint] of Object.entries(codepoints)) {
		assert.equal(config.icons[key].codePointAt(0), codepoint, key);
	}
	const { rows } = await renderFooter(config);
	const rendered = rows.join(" ");
	assert.ok(rendered.includes(`${robot} model (provider)`));
	assert.ok(rendered.includes(`${brain} medium`));
	assert.ok(rendered.includes(`${cacheHit} 80.0%`));
	assert.ok(rendered.includes(`${cacheRead} 400 ${cacheWrite} 0`));
});

test("ASCII mode and individual icon overrides remain available", async () => {
	const ascii = (await renderFooter({ icons: "ascii" })).rows.join(" ");
	assert.ok(ascii.includes("model (provider)"));
	assert.ok(ascii.includes("↑ 100 ↓ 20"));
	assert.ok(ascii.includes("R 400 W 0"));
	assert.ok(ascii.includes("% 80.0%"));
	assert.ok(!ascii.includes(robot));
	const custom = (await renderFooter({ icons: { model: "", thinking: "*", path: "@", context: "#" } })).rows.join(" ");
	assert.ok(custom.includes("model (provider)"));
	assert.ok(custom.includes("* medium"));
	assert.ok(custom.includes("@ "));
	assert.ok(custom.includes("# 20.0%/1.0k (auto)"));
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
