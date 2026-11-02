import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Usage } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
	ReadonlyFooterDataProvider,
	SessionEntry,
	Theme,
	ThemeBg,
	ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { parseColor, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type HexColor = `#${string}`;
type ForegroundColor = ThemeColor | HexColor | number;
type BackgroundColor = ThemeBg | HexColor | number;

type IconName =
	| "model" | "thinking" | "path" | "context" | "tokenInput" | "tokenOutput"
	| "cacheRead" | "cacheWrite" | "cacheHit" | "toolCount" | "pluginCount"
	| "sessionTime" | "gitBranch";
type FooterIcons = Record<IconName, string>;

type FooterTheme = {
	provider: ForegroundColor;
	model: ForegroundColor;
	thinking: ForegroundColor;
	path: ForegroundColor;
	git: ForegroundColor;
	gitDirty: ForegroundColor;
	context: ForegroundColor;
	contextWarn: ForegroundColor;
	contextError: ForegroundColor;
	tokens: ForegroundColor;
	cache: ForegroundColor;
	cachePercent: ForegroundColor;
	cost: ForegroundColor;
	sessionTime: ForegroundColor;
	separator: ForegroundColor;
	background?: BackgroundColor;
	icons: FooterIcons;
	paddingLeft: number;
	refreshMs: number;
};

type GitCounts = {
	staged: number;
	unstaged: number;
	untracked: number;
};

const NERD_ICONS: FooterIcons = {
	model: "\u{F167A}",
	thinking: "\u{F09D1}",
	path: "\u{F0256}",
	context: "\u{F07AF}",
	tokenInput: "\u{F0737}",
	tokenOutput: "\u{F072E}",
	cacheRead: "\u{F163B}",
	cacheWrite: "\u{F163E}",
	cacheHit: "\u{F0AA9}",
	toolCount: "\u{F1064}",
	pluginCount: "\u{F03D7}",
	sessionTime: "\u{F051B}",
	gitBranch: "\uF126",
};

const DEFAULT_THEME_PATH = join(dirname(fileURLToPath(import.meta.url)), "footer-theme.default.json");
const DEFAULT_THEME_OPTIONS: Pick<FooterTheme, "icons" | "paddingLeft" | "refreshMs"> = {
	icons: { ...NERD_ICONS },
	paddingLeft: 2,
	refreshMs: 5000,
};
const THEME_COLOR_KEYS = [
	"provider", "model", "thinking", "path", "git", "gitDirty", "context", "contextWarn",
	"contextError", "tokens", "cache", "cachePercent", "cost", "sessionTime", "separator",
] as const satisfies readonly (keyof FooterTheme)[];
type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number];

const FOREGROUND_TOKENS = new Set<ThemeColor>([
	"accent",
	"border",
	"borderAccent",
	"borderMuted",
	"success",
	"error",
	"warning",
	"muted",
	"dim",
	"text",
	"thinkingOff",
	"thinkingMinimal",
	"thinkingLow",
	"thinkingMedium",
	"thinkingHigh",
	"thinkingXhigh",
	"thinkingMax",
	"thinkingText",
	"toolTitle",
	"toolOutput",
	"mdHeading",
	"mdLink",
	"mdLinkUrl",
	"mdCode",
	"mdCodeBlock",
	"mdCodeBlockBorder",
	"mdQuote",
	"mdQuoteBorder",
	"mdHr",
	"mdListBullet",
	"toolDiffAdded",
	"toolDiffRemoved",
	"toolDiffContext",
	"syntaxComment",
	"syntaxKeyword",
	"syntaxFunction",
	"syntaxVariable",
	"syntaxString",
	"syntaxNumber",
	"syntaxType",
	"syntaxOperator",
	"syntaxPunctuation",
	"bashMode",
]);

const BACKGROUND_TOKENS = new Set<ThemeBg>([
	"selectedBg",
	"searchMatchBg",
	"userMessageBg",
	"customMessageBg",
	"toolPendingBg",
	"toolSuccessBg",
	"toolErrorBg",
]);

const ASCII_ICONS: FooterIcons = {
	model: "",
	thinking: "",
	path: "",
	context: "",
	tokenInput: "↑",
	tokenOutput: "↓",
	cacheRead: "R",
	cacheWrite: "W",
	cacheHit: "%",
	toolCount: "T",
	pluginCount: "P",
	sessionTime: "",
	gitBranch: "",
};

function parseIcons(value: unknown): FooterIcons {
	if (value === "nerd") return { ...NERD_ICONS };
	if (value === "ascii") return { ...ASCII_ICONS };
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		const input = value as Record<string, unknown>;
		const icons: FooterIcons = input.mode === "ascii" ? { ...ASCII_ICONS } : { ...NERD_ICONS };
		for (const key of Object.keys(NERD_ICONS) as IconName[]) {
			if (typeof input[key] === "string") icons[key] = input[key];
		}
		return icons;
	}
	return { ...NERD_ICONS };
}

function getConfigPath(): string {
	const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
	return join(agentDir, "simple-status-footer.json");
}

function isHexColor(value: string): value is HexColor {
	return /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value);
}

function isForegroundColor(value: unknown): value is ForegroundColor {
	if (typeof value === "number") return Number.isInteger(value) && value >= 0 && value <= 255;
	return typeof value === "string" && (FOREGROUND_TOKENS.has(value as ThemeColor) || isHexColor(value));
}

function isBackgroundColor(value: unknown): value is BackgroundColor {
	if (typeof value === "number") return Number.isInteger(value) && value >= 0 && value <= 255;
	return typeof value === "string" && (BACKGROUND_TOKENS.has(value as ThemeBg) || isHexColor(value));
}


function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createDefaultTheme(value: unknown): FooterTheme {
	if (!isRecord(value)) throw new Error("Default footer theme must be a JSON object");
	const colors = {} as Pick<FooterTheme, ThemeColorKey>;
	for (const key of THEME_COLOR_KEYS) {
		const color = value[key];
		if (!isForegroundColor(color)) throw new Error(`Invalid default footer color: ${key}`);
		colors[key] = color;
	}
	const theme: FooterTheme = { ...colors, ...DEFAULT_THEME_OPTIONS };
	if (value.background !== undefined) {
		if (!isBackgroundColor(value.background)) throw new Error("Invalid default footer background");
		theme.background = value.background;
	}
	return theme;
}

function applyThemeOverrides(theme: FooterTheme, input: Record<string, unknown>): FooterTheme {
	for (const key of THEME_COLOR_KEYS) {
		if (isForegroundColor(input[key])) theme[key] = input[key];
	}
	if (isBackgroundColor(input.background)) theme.background = input.background;
	if (typeof input.paddingLeft === "number" && Number.isFinite(input.paddingLeft)) {
		theme.paddingLeft = Math.min(8, Math.max(0, Math.round(input.paddingLeft)));
	}
	if (typeof input.refreshMs === "number" && Number.isFinite(input.refreshMs)) {
		theme.refreshMs = Math.min(60_000, Math.max(1_000, Math.round(input.refreshMs)));
	}
	theme.icons = parseIcons(input.icons);
	return theme;
}

async function loadDefaultTheme(): Promise<FooterTheme> {
	const value: unknown = JSON.parse(await readFile(DEFAULT_THEME_PATH, "utf8"));
	return createDefaultTheme(value);
}

async function loadTheme(): Promise<FooterTheme> {
	const defaults = await loadDefaultTheme();
	try {
		const value: unknown = JSON.parse(await readFile(getConfigPath(), "utf8"));
		if (!isRecord(value)) return defaults;
		return applyThemeOverrides(defaults, value);
	} catch {
		return defaults;
	}
}

function formatTokens(count: number): string {
	if (count < 1_000) return `${count}`;
	if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}

function formatDuration(milliseconds: number): string {
	const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
	const hours = Math.floor(totalSeconds / 3_600);
	const minutes = Math.floor((totalSeconds % 3_600) / 60);
	const seconds = totalSeconds % 60;
	return hours > 0
		? `${hours}h${String(minutes).padStart(2, "0")}m`
		: `${minutes}m${String(seconds).padStart(2, "0")}s`;
}

function formatPath(path: string): string {
	const home = homedir();
	const absolutePath = resolve(path);
	const relativePath = relative(home, absolutePath);
	if (relativePath === "") return "~";
	if (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath)) {
		return `~${sep}${relativePath}`;
	}
	return absolutePath;
}

function parseGitStatus(output: string): GitCounts {
	const counts: GitCounts = { staged: 0, unstaged: 0, untracked: 0 };
	for (const line of output.split("\n")) {
		if (line.length < 2) continue;
		const indexStatus = line[0];
		const worktreeStatus = line[1];
		if (indexStatus === "?") {
			counts.untracked++;
			continue;
		}
		if (indexStatus !== " ") counts.staged++;
		if (worktreeStatus !== " ") counts.unstaged++;
	}
	return counts;
}

function addUsage(total: Usage, usage: Usage): void {
	total.input += usage.input;
	total.output += usage.output;
	total.cacheRead += usage.cacheRead;
	total.cacheWrite += usage.cacheWrite;
	total.totalTokens += usage.totalTokens;
	total.cost.input += usage.cost.input;
	total.cost.output += usage.cost.output;
	total.cost.cacheRead += usage.cost.cacheRead;
	total.cost.cacheWrite += usage.cost.cacheWrite;
	total.cost.total += usage.cost.total;
}

function getSessionUsage(entries: SessionEntry[]): { usage: Usage; latestCacheHitRate?: number } {
	const usage: Usage = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	let latestCacheHitRate: number | undefined;

	for (const entry of entries) {
		let entryUsage: Usage | undefined;
		if (entry.type === "usage") {
			entryUsage = entry.usage;
		} else if (entry.type === "message" && entry.message.role === "assistant") {
			entryUsage = entry.message.usage;
			const promptTokens = entryUsage.input + entryUsage.cacheRead + entryUsage.cacheWrite;
			latestCacheHitRate = promptTokens > 0 ? (entryUsage.cacheRead / promptTokens) * 100 : undefined;
		} else if (entry.type === "message" && entry.message.role === "toolResult") {
			entryUsage = entry.message.usage;
		} else if ((entry.type === "compaction" || entry.type === "branch_summary") && entry.usage) {
			entryUsage = entry.usage;
		}
		if (entryUsage) addUsage(usage, entryUsage);
	}
	return { usage, latestCacheHitRate };
}

function colorText(theme: Theme, color: ForegroundColor, text: string): string {
	if (typeof color === "number" || (typeof color === "string" && isHexColor(color))) {
		return theme.style(text, { fg: parseColor(color) });
	}
	return theme.fg(color, text);
}

function backgroundText(theme: Theme, color: BackgroundColor, text: string): string {
	if (typeof color === "number" || (typeof color === "string" && isHexColor(color))) {
		return theme.style(text, { bg: parseColor(color) });
	}
	return theme.bg(color, text);
}

function wrapSegments(segments: string[], width: number, separator: string): string[] {
	const rows: string[] = [];
	let row = "";
	for (const segment of segments) {
		const candidate = row ? `${row} ${separator} ${segment}` : segment;
		if (visibleWidth(candidate) <= width) {
			row = candidate;
			continue;
		}
		if (row) rows.push(row);
		row = truncateToWidth(segment, width, "…");
	}
	if (row) rows.push(row);
	return rows;
}

export default function (pi: ExtensionAPI): void {
	let currentContext: ExtensionContext | undefined;
	let clockInterval: ReturnType<typeof setInterval> | undefined;
	let gitInterval: ReturnType<typeof setInterval> | undefined;
	let refreshGit: (() => void) | undefined;
	let refreshFooter: (() => void) | undefined;
	let gitRefreshInFlight = false;
	let gitCounts: GitCounts = { staged: 0, unstaged: 0, untracked: 0 };
	let sessionStartedAt = Date.now();
	let sessionId = "";

	function getSessionStartTime(context: ExtensionContext): number {
		const timestamp = context.sessionManager.getHeader()?.timestamp;
		if (!timestamp) return Date.now();
		const parsed = Date.parse(timestamp);
		return Number.isFinite(parsed) ? parsed : Date.now();
	}

	function updateContext(context: ExtensionContext): void {
		currentContext = context;
		const nextSessionId = context.sessionManager.getSessionId();
		if (nextSessionId !== sessionId) {
			sessionId = nextSessionId;
			sessionStartedAt = getSessionStartTime(context);
			gitCounts = { staged: 0, unstaged: 0, untracked: 0 };
		}
		void refreshGit?.();
	}

	pi.on("session_start", (_event, context) => updateContext(context));
	pi.on("session_info_changed", (_event, context) => {
		currentContext = context;
		refreshFooter?.();
	});
	pi.on("session_tree", (_event, context) => {
		currentContext = context;
		refreshFooter?.();
	});
	pi.on("model_select", (_event, context) => {
		currentContext = context;
		refreshFooter?.();
	});
	pi.on("thinking_level_select", (_event, context) => {
		currentContext = context;
		refreshFooter?.();
	});
	pi.on("message_update", (_event, context) => {
		currentContext = context;
		refreshFooter?.();
	});
	pi.on("message_end", (_event, context) => {
		currentContext = context;
		refreshFooter?.();
	});
	pi.on("agent_end", (_event, context) => {
		currentContext = context;
		refreshFooter?.();
	});

	pi.on("session_shutdown", () => {
		if (clockInterval) clearInterval(clockInterval);
		if (gitInterval) clearInterval(gitInterval);
		clockInterval = undefined;
		gitInterval = undefined;
		refreshGit = undefined;
		refreshFooter = undefined;
		currentContext = undefined;
	});

	pi.on("session_start", async (_event, context) => {
		if (context.mode !== "tui") return;
		const config = await loadTheme();

		context.ui.setFooter((tui, theme, footerData: ReadonlyFooterDataProvider) => {
			let disposed = false;
			const unsubscribeBranch = footerData.onBranchChange(() => {
				void refreshGit?.();
				refreshFooter?.();
			});

			refreshFooter = () => {
				if (!disposed) tui.requestRender();
			};
			refreshGit = async () => {
				if (disposed || gitRefreshInFlight || !currentContext) return;
				gitRefreshInFlight = true;
				const cwd = currentContext.sessionManager.getCwd();
				try {
					const result = await pi.exec("git", ["status", "--porcelain=v1", "-uall"], {
						cwd,
						timeout: 2_000,
					});
					if (!disposed && currentContext?.sessionManager.getCwd() === cwd) {
						gitCounts = result.code === 0 ? parseGitStatus(result.stdout) : { staged: 0, unstaged: 0, untracked: 0 };
					}
				} catch {
					gitCounts = { staged: 0, unstaged: 0, untracked: 0 };
				} finally {
					gitRefreshInFlight = false;
					if (!disposed) tui.requestRender();
				}
			};

			void refreshGit();
			return {
				dispose() {
					disposed = true;
					unsubscribeBranch();
					if (refreshFooter) refreshFooter = undefined;
					if (refreshGit) refreshGit = undefined;
				},
			invalidate() {},
			render(width: number): string[] {
				const ctx = currentContext;
				if (!ctx || width <= 0) return [];

				const model = ctx.model;
				const sessionUsage = getSessionUsage(ctx.sessionManager.getEntries());
				const usage = sessionUsage.usage;
				const contextUsage = ctx.getContextUsage();
				const contextWindow = contextUsage?.contextWindow ?? model?.contextWindow ?? 0;
				const contextPercent = contextUsage?.percent;
				const branch = footerData.getGitBranch();
				const dirty = gitCounts.staged + gitCounts.unstaged + gitCounts.untracked > 0;
				const thinkingLevel = ctx.thinkingLevel ?? pi.getThinkingLevel();
				const sessionName = ctx.sessionManager.getSessionName();
				const icons = config.icons;
				const separator = colorText(theme, config.separator, "│");
				const part = (color: ForegroundColor, text: string) => colorText(theme, color, text);
				const iconPrefix = (icon: string) => (icon ? `${icon} ` : "");
				const modelSegment = model
					? `${part(config.model, `${iconPrefix(icons.model)}${model.id}`)} ${part(config.provider, `(${model.provider})`)}`
					: part(config.model, `${iconPrefix(icons.model)}no-model`);
				const segments: string[] = [
					modelSegment,
					part(config.thinking, `${iconPrefix(icons.thinking)}${thinkingLevel}`),
					part(config.path, `${iconPrefix(icons.path)}${formatPath(ctx.sessionManager.getCwd())}${sessionName ? ` · ${sessionName}` : ""}`),
				];
				if (branch) {
					segments.push(part(dirty ? config.gitDirty : config.git, `${iconPrefix(icons.gitBranch)}${branch} +${gitCounts.staged} ~${gitCounts.unstaged} ?${gitCounts.untracked}`));
				}
				if (usage.input || usage.output) {
					segments.push(part(config.tokens, `${iconPrefix(icons.tokenInput)}${formatTokens(usage.input)} ${iconPrefix(icons.tokenOutput)}${formatTokens(usage.output)}`));
				}
				if (usage.cacheRead || usage.cacheWrite) {
					segments.push(part(config.cache, `${iconPrefix(icons.cacheRead)}${formatTokens(usage.cacheRead)} ${iconPrefix(icons.cacheWrite)}${formatTokens(usage.cacheWrite)}`));
					if (sessionUsage.latestCacheHitRate !== undefined) {
						segments.push(part(config.cachePercent, `${iconPrefix(icons.cacheHit)}${sessionUsage.latestCacheHitRate.toFixed(1)}%`));
					}
				}
				const subscription = model
					? model.provider === "kimi-coding" || ctx.modelRegistry.isUsingOAuth(model)
					: false;
				if (usage.cost.total || subscription) {
					segments.push(part(config.cost, `$ ${usage.cost.total.toFixed(3)}${subscription ? " (sub)" : ""}`));
				}

				const settings = pi.getSettings();
				const autoCompactEnabled = settings.compaction?.enabled !== false;
				const autoSuffix = autoCompactEnabled ? " (auto)" : "";
				if (contextPercent === null || contextPercent === undefined) {
					segments.push(part(config.context, `${iconPrefix(icons.context)}?/${formatTokens(contextWindow)}${autoSuffix}`));
				} else {
					const contextColor = contextPercent > 90 ? config.contextError : contextPercent > 70 ? config.contextWarn : config.context;
					segments.push(part(contextColor, `${iconPrefix(icons.context)}${contextPercent.toFixed(1)}%/${formatTokens(contextWindow)}${autoSuffix}`));
				}
				segments.push(part(config.sessionTime, `${iconPrefix(icons.sessionTime)}${formatDuration(Date.now() - sessionStartedAt)}`));

				const padding = " ".repeat(Math.min(config.paddingLeft, width - 1));
				const contentWidth = width - padding.length;
				const rows = wrapSegments(segments, contentWidth, separator);
				const toolCount = pi.getActiveTools().length;
				const pluginPackageCount = settings.packages?.length ?? 0;
				const extensionStatuses = [...footerData.getExtensionStatuses().entries()]
					.sort(([left], [right]) => left.localeCompare(right))
					.flatMap(([key, text]) => {
						const status = text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
						if (!status) return [];
						if (key !== "mcp") return [status];
						return [
							status,
							part(config.sessionTime, `${iconPrefix(icons.toolCount)}Tools: ${toolCount}`),
							part(config.sessionTime, `${iconPrefix(icons.pluginCount)}Plugins: ${pluginPackageCount}`),
						];
					});
				if (extensionStatuses.length > 0) {
					rows.push(...wrapSegments(extensionStatuses, contentWidth, separator));
				}
				return rows.map(row => padding + (config.background ? backgroundText(theme, config.background, row) : row));
			},
			};
		});

		if (clockInterval) clearInterval(clockInterval);
		if (gitInterval) clearInterval(gitInterval);
		clockInterval = setInterval(() => {
			refreshFooter?.();
		}, 1000);
		gitInterval = setInterval(() => {
			void refreshGit?.();
		}, config.refreshMs);
	});

	// Create a starter config only when explicitly requested by the user.
	pi.registerCommand("status-theme-reset", {
		description: "Reset the simple status footer theme",
		handler: async (_args, context) => {
			const path = getConfigPath();
			await mkdir(dirname(path), { recursive: true });
			const defaults = await loadDefaultTheme();
			await writeFile(path, `${JSON.stringify(defaults, null, 2)}\n`, "utf8");
			context.ui.notify(`Theme reset at ${path}. Run /reload to apply it.`, "info");
		},
	});
}
