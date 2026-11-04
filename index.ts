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
	| "model" | "thinking" | "path" | "context" | "tokenInput" | "tokenOutput" | "tokenTotal"
	| "cacheRead" | "cacheWrite" | "cacheHit" | "lastRequest" | "toolCount" | "pluginCount"
	| "gitBranch";
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
	tokenInput: ForegroundColor;
	tokenOutput: ForegroundColor;
	tokenTotal: ForegroundColor;
	lastLabel: ForegroundColor;
	totalLabel: ForegroundColor;
	cacheRead: ForegroundColor;
	cacheWrite: ForegroundColor;
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
	tokenTotal: "\u{F04A0}",
	cacheRead: "\u{F163B}",
	cacheWrite: "\u{F163E}",
	cacheHit: "\u{F0AA9}",
	lastRequest: "\u{F02DA}",
	toolCount: "\u{F1064}",
	pluginCount: "\u{F03D7}",
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
	"contextError", "tokens", "tokenInput", "tokenOutput", "tokenTotal", "lastLabel", "totalLabel", "cacheRead", "cacheWrite", "cache", "cachePercent", "cost", "sessionTime", "separator",
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
	tokenTotal: "Σ",
	cacheRead: "R",
	cacheWrite: "W",
	cacheHit: "%",
	lastRequest: "L",
	toolCount: "T",
	pluginCount: "P",
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
	// Metric colors remain independent of the older group/label colors.
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

function formatExactTokens(count: number): string {
	return `${Math.round(count)}`;
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
		if (indexStatus === "!") continue;
		if (indexStatus === "?") {
			counts.untracked++;
			continue;
		}
		if (indexStatus !== " ") counts.staged++;
		if (worktreeStatus !== " ") counts.unstaged++;
	}
	return counts;
}

// Pi's normalized input excludes cache reads/writes; reasoning is already in output.
function getTotalTokens(usage: Usage): number {
	return usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

function addUsage(total: Usage, usage: Usage): void {
	total.input += usage.input;
	total.output += usage.output;
	total.cacheRead += usage.cacheRead;
	total.cacheWrite += usage.cacheWrite;
	total.totalTokens += getTotalTokens(usage);
	total.cost.input += usage.cost.input;
	total.cost.output += usage.cost.output;
	total.cost.cacheRead += usage.cost.cacheRead;
	total.cost.cacheWrite += usage.cost.cacheWrite;
	total.cost.total += usage.cost.total;
}

function getCacheHitRate(usage: Usage): number | undefined {
	const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
	return promptTokens > 0 ? (usage.cacheRead / promptTokens) * 100 : undefined;
}

type SessionUsage = {
	usage: Usage;
	cacheHitRate?: number;
	lastUsage?: Usage;
	lastCacheHitRate?: number;
};

function getSessionUsage(entries: SessionEntry[]): SessionUsage {
	const usage: Usage = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	let lastUsage: Usage | undefined;

	for (const entry of entries) {
		let entryUsage: Usage | undefined;
		if (entry.type === "usage") {
			entryUsage = entry.usage;
		} else if (entry.type === "message" && entry.message.role === "assistant") {
			entryUsage = entry.message.usage;
			lastUsage = entryUsage;
		} else if (entry.type === "message" && entry.message.role === "toolResult") {
			entryUsage = entry.message.usage;
		} else if ((entry.type === "compaction" || entry.type === "branch_summary") && entry.usage) {
			entryUsage = entry.usage;
		}
		if (entryUsage) addUsage(usage, entryUsage);
	}

	return {
		usage,
		cacheHitRate: getCacheHitRate(usage),
		lastUsage,
		lastCacheHitRate: lastUsage ? getCacheHitRate(lastUsage) : undefined,
	};
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

function wrapSegments(segments: string[], width: number, separator: string, gap = ` ${separator} `): string[] {
	const rows: string[] = [];
	let row = "";
	for (const segment of segments) {
		const candidate = row ? `${row}${gap}${segment}` : segment;
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
	let gitInterval: ReturnType<typeof setInterval> | undefined;
	let refreshGit: (() => void) | undefined;
	let refreshFooter: (() => void) | undefined;
	let gitRefreshInFlight = false;
	let gitCounts: GitCounts = { staged: 0, unstaged: 0, untracked: 0 };
	let sessionId = "";

	function updateContext(context: ExtensionContext): void {
		currentContext = context;
		const nextSessionId = context.sessionManager.getSessionId();
		if (nextSessionId !== sessionId) {
			sessionId = nextSessionId;
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
	// message_end runs before persistence; turn_end sees the appended usage entries.
	pi.on("turn_end", (_event, context) => {
		currentContext = context;
		refreshFooter?.();
	});
	pi.on("agent_end", (_event, context) => {
		currentContext = context;
		refreshFooter?.();
	});
	pi.on("session_compact", (_event, context) => {
		currentContext = context;
		refreshFooter?.();
	});

	pi.on("session_shutdown", () => {
		if (gitInterval) clearInterval(gitInterval);
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
				const totalSegments: string[] = [];
				const requestSegments: string[] = [];
				if (usage.input || usage.output) {
					totalSegments.push(part(config.tokenInput, `${iconPrefix(icons.tokenInput)}${formatTokens(usage.input)}`));
					totalSegments.push(part(config.tokenOutput, `${iconPrefix(icons.tokenOutput)}${formatTokens(usage.output)}`));
				}
				if (usage.totalTokens) {
					totalSegments.push(part(config.tokenTotal, `${iconPrefix(icons.tokenTotal)}${formatTokens(usage.totalTokens)}`));
				}
				if (usage.cacheRead || usage.cacheWrite) {
					totalSegments.push(part(config.cacheRead, `${iconPrefix(icons.cacheRead)}${formatTokens(usage.cacheRead)}`));
					totalSegments.push(part(config.cacheWrite, `${iconPrefix(icons.cacheWrite)}${formatTokens(usage.cacheWrite)}`));
					if (sessionUsage.cacheHitRate !== undefined) {
						totalSegments.push(part(config.cachePercent, `${iconPrefix(icons.cacheHit)}avg ${sessionUsage.cacheHitRate.toFixed(1)}%`));
					}
				}
				const last = sessionUsage.lastUsage;
				if (last) {
					const prefix = iconPrefix(icons.lastRequest);
					const lastParts = [
						part(config.tokenInput, `${iconPrefix(icons.tokenInput)}${formatExactTokens(last.input)}`),
						part(config.tokenOutput, `${iconPrefix(icons.tokenOutput)}${formatExactTokens(last.output)}`),
						part(config.tokenTotal, `${iconPrefix(icons.tokenTotal)}${formatExactTokens(getTotalTokens(last))}`),
						part(config.cacheRead, `${iconPrefix(icons.cacheRead)}${formatExactTokens(last.cacheRead)}`),
						part(config.cacheWrite, `${iconPrefix(icons.cacheWrite)}${formatExactTokens(last.cacheWrite)}`),
					];
					// A zero-read request after earlier cache activity is a 0% hit, not missing data.
					if ((usage.cacheRead || usage.cacheWrite) && sessionUsage.lastCacheHitRate !== undefined) {
						lastParts.push(part(config.cachePercent, `${iconPrefix(icons.cacheHit)}${sessionUsage.lastCacheHitRate.toFixed(1)}%`));
					}
					const lastSegment = part(config.tokens, prefix) + lastParts.join("   ");
					if (visibleWidth(lastSegment) + "Last ".length <= width - Math.min(config.paddingLeft, width - 1)) {
						requestSegments.push(lastSegment);
					} else {
						requestSegments.push(...lastParts.map(text => part(config.tokens, prefix) + text));
					}
				}
				const subscription = model
					? model.provider === "kimi-coding" || (
						ctx.modelRegistry.isUsingOAuth(model) &&
						ctx.modelRegistry.getProvider(model.provider)?.auth?.oauth?.isSubscription === true
					)
					: false;
				const costSegment = usage.cost.total || subscription
					? part(config.cost, `$ ${usage.cost.total.toFixed(3)}${subscription ? " (sub)" : ""}`)
					: undefined;

				const settings = pi.getSettings();
				const autoCompactEnabled = settings.compaction?.enabled !== false;
				const autoSuffix = autoCompactEnabled ? " (auto)" : "";
				const contextSize = `${contextUsage?.tokens == null ? "?" : formatTokens(contextUsage.tokens)}/${formatTokens(contextWindow)}`;
				if (contextPercent === null || contextPercent === undefined) {
					segments.push(part(config.context, `${iconPrefix(icons.context)}${contextSize}${autoSuffix}`));
				} else {
					const contextColor = contextPercent > 90 ? config.contextError : contextPercent > 70 ? config.contextWarn : config.context;
					segments.push(part(contextColor, `${iconPrefix(icons.context)}${contextSize} ${contextPercent.toFixed(1)}%${autoSuffix}`));
				}
				const padding = " ".repeat(Math.min(config.paddingLeft, width - 1));
				const contentWidth = width - padding.length;
				const rows = wrapSegments(segments, contentWidth, separator);
				// Keep model/context information above usage, even when both fit on one row.
				if (requestSegments.length > 0) requestSegments[0] = part(config.lastLabel, "Last ") + requestSegments[0];
				if (totalSegments.length > 0) {
					totalSegments[0] = (requestSegments.length > 0 ? `${separator}   ` : "") + part(config.totalLabel, "Total ") + totalSegments[0];
				}
				const usageSegments = [...requestSegments, ...totalSegments];
				if (costSegment) usageSegments.push((usageSegments.length > 0 ? `${separator}   ` : "") + costSegment);
				rows.push(...wrapSegments(usageSegments, contentWidth, "", "   "));
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

		if (gitInterval) clearInterval(gitInterval);
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
