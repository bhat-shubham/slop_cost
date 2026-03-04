import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';

type DailyCost = {
	date: string;
	environment: string;
	total_cost_usd: string;
	total_tokens: number;
	request_count: number;
};

type CostExplanation = {
	date: string;
	environment: string;
	summary: string;
	key_drivers: string[];
	recommendations: string[];
};

type CostByModel = {
	date: string;
	model_name: string;
	environment: string;
	total_cost_usd: string;
	total_tokens: number;
	request_count: number;
};

type CostByEndpoint = {
	date: string;
	endpoint: string;
	environment: string;
	total_cost_usd: string;
	total_tokens: number;
	request_count: number;
};

// ── Global Proxy State ──────────────────────────────────────
let proxyServer: http.Server | null = null;

// ── Types: Local Model Recommender ─────────────────────────

type PromptFeatures = {
	charLength: number;
	estimatedTokens: number;
	hasCode: boolean;
	hasStackTrace: boolean;
	intent: 'explain' | 'debug' | 'generate' | 'summarize' | 'other';
	reasoningLevel: 'low' | 'medium' | 'high';
	latencySensitive: boolean;
};

type ModelRecommendation = {
	model: string;
	reason: string;
	confidence: 'low' | 'medium' | 'high';
	category: keyof typeof MODEL_CATALOG;
};

interface ModelMetadata {
	id: string;
	ideFocus: string[]; // Major IDE where this is a primary option
	access: 'Free' | 'Paid' | 'BYOK';
	categories: CategoryKey[];
}

// ── Model Directory ─────────────────────────────────────────────────────────
const MODEL_DIRECTORY: ModelMetadata[] = [
	// --- HIGH REASONING ---
	{ id: 'claude-opus-4.6', ideFocus: ['Antigravity', 'Cursor'], access: 'Paid', categories: ['HIGH_REASONING'] },
	{ id: 'claude-opus-4.5', ideFocus: ['Cursor', 'JetBrains'], access: 'Paid', categories: ['HIGH_REASONING'] },
	{ id: 'gemini-3.1-pro', ideFocus: ['Antigravity', 'Windsurf'], access: 'Paid', categories: ['HIGH_REASONING', 'CODE'] },
	{ id: 'gpt-5.2', ideFocus: ['Antigravity', 'Copilot'], access: 'Paid', categories: ['HIGH_REASONING'] },
	{ id: 'o3', ideFocus: ['Copilot', 'Cursor'], access: 'Paid', categories: ['HIGH_REASONING'] },
	{ id: 'gpt-5', ideFocus: ['Copilot'], access: 'Paid', categories: ['HIGH_REASONING'] },
	{ id: 'gpt-oss-120b', ideFocus: ['Cursor', 'BYOK'], access: 'BYOK', categories: ['HIGH_REASONING'] },

	// --- CODE & DEBUGGING ---
	{ id: 'claude-sonnet-4.6', ideFocus: ['Antigravity', 'Cursor'], access: 'Paid', categories: ['CODE', 'GENERAL'] },
	{ id: 'claude-sonnet-4.5', ideFocus: ['Cursor', 'Windsurf'], access: 'Paid', categories: ['CODE'] },
	{ id: 'claude-sonnet-4', ideFocus: ['Cursor'], access: 'Paid', categories: ['CODE'] },
	{ id: 'deepseek-v3', ideFocus: ['Cursor', 'BYOK'], access: 'Free', categories: ['CODE'] },
	{ id: 'gemini-2.5-pro', ideFocus: ['JetBrains', 'Copilot'], access: 'Paid', categories: ['CODE'] },
	{ id: 'gpt-4.1', ideFocus: ['Copilot'], access: 'Paid', categories: ['CODE', 'GENERAL'] },
	{ id: 'gpt-5-mini', ideFocus: ['Copilot'], access: 'Paid', categories: ['CODE'] },
	{ id: 'grok-code-fast-1', ideFocus: ['Copilot'], access: 'Paid', categories: ['CODE'] },

	// --- FAST / LOW LATENCY ---
	{ id: 'claude-haiku-4.5', ideFocus: ['Copilot', 'JetBrains'], access: 'Paid', categories: ['FAST'] },
	{ id: 'gemini-3-flash', ideFocus: ['Antigravity', 'Windsurf'], access: 'Free', categories: ['FAST', 'GENERAL'] },
	{ id: 'gemini-2.5-flash', ideFocus: ['JetBrains'], access: 'BYOK', categories: ['FAST'] },
	{ id: 'gpt-4o-mini', ideFocus: ['Cursor', 'Copilot'], access: 'Free', categories: ['FAST'] },
	{ id: 'grok-3-mini', ideFocus: ['Cursor'], access: 'Free', categories: ['FAST'] },
	{ id: 'raptor-mini', ideFocus: ['Copilot'], access: 'Paid', categories: ['FAST'] },

	// --- GENERAL ---
	{ id: 'gpt-4o', ideFocus: ['Copilot'], access: 'Paid', categories: ['GENERAL'] },
];

const MODEL_CATALOG = {
	HIGH_REASONING: MODEL_DIRECTORY.filter(m => m.categories.includes('HIGH_REASONING')).map(m => m.id),
	CODE: MODEL_DIRECTORY.filter(m => m.categories.includes('CODE')).map(m => m.id),
	FAST: MODEL_DIRECTORY.filter(m => m.categories.includes('FAST')).map(m => m.id),
	GENERAL: MODEL_DIRECTORY.filter(m => m.categories.includes('GENERAL')).map(m => m.id),
} as const;

// Rotate through models using a time-based index (changes every minute)
// so no vendor is systematically favoured over time.
// Filters to only models the user has marked as enabled before rotating.
function pickFromCategory(
	category: keyof typeof MODEL_CATALOG,
	enabledModels: string[]
): string {
	// Only consider models from this category that the user has enabled
	const candidates = (MODEL_CATALOG[category] as readonly string[]).filter(
		m => enabledModels.includes(m)
	);
	// Fallback: if none from this category are enabled, use any enabled model
	const pool = candidates.length > 0 ? candidates : enabledModels;
	if (pool.length === 0) { return DEFAULT_ENABLED_MODELS[0]; }
	const index = Math.floor(Date.now() / 60_000) % pool.length;
	return pool[index];
}

// ── Enabled Models (user-declared) ────────────────────────
const ENABLED_MODELS_KEY = 'slopcost.enabledModels';
// Safe defaults: cheap, fast, widely available on free tiers
const DEFAULT_ENABLED_MODELS = ['gpt-4o-mini', 'gemini-3-flash', 'claude-haiku-4.5'];

function getEnabledModels(context: vscode.ExtensionContext): string[] {
	const stored = context.globalState.get<string[]>(ENABLED_MODELS_KEY);
	return stored && stored.length > 0 ? stored : DEFAULT_ENABLED_MODELS;
}

// ── Module-level state ─────────────────────────────────────

let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

// ─── Session Accumulator ─────────────────────────────────────────────────────
// Tracks AI usage patterns across the current VS Code window session.
// Resets on extension deactivation (intentional — session = this window).

type CategoryKey = 'HIGH_REASONING' | 'CODE' | 'FAST' | 'GENERAL';

// Weight reflects how "expensive" each category is relative to task complexity.
// Used to compute a weighted average over the session.
const CATEGORY_WEIGHTS: Record<CategoryKey, number> = {
	HIGH_REASONING: 4,
	CODE: 3,
	GENERAL: 2,
	FAST: 1,
};

type SessionState = {
	totalTokensEstimated: number;
	recommendationCount: number;
	categoryBreakdown: Record<CategoryKey, number>;  // count per category
	weightedCategorySum: number;                        // sum of weights seen
	startedAt: Date;
	peakSlopScore: number;
	fileBreakdown: Map<string, { tokens: number; recommendations: number }>;
};

function createSession(): SessionState {
	return {
		totalTokensEstimated: 0,
		recommendationCount: 0,
		categoryBreakdown: { HIGH_REASONING: 0, CODE: 0, FAST: 0, GENERAL: 0 },
		weightedCategorySum: 0,
		startedAt: new Date(),
		peakSlopScore: 0,
		fileBreakdown: new Map(),
	};
}

// Compute Slop Score from accumulated session data.
// Returns null if not enough data yet (< 3 recommendations).
function computeSlopScore(session: SessionState): number | null {
	if (session.recommendationCount < 3) {
		return null;  // too early — score would be meaningless noise
	}

	// Tokens per recommendation — how much AI burn per discrete task
	const tokensPerRec = session.totalTokensEstimated / session.recommendationCount;

	// Average category weight — were recommendations skewing heavy or light?
	const avgCategoryWeight = session.weightedCategorySum / session.recommendationCount;

	// Score = token burn rate * category heaviness
	// High score = burning lots of tokens on heavy models = slop
	// Low score  = efficient use of cheap/fast models
	return (tokensPerRec / 100) * avgCategoryWeight;
	//      ↑ divide by 100 to keep the number human-readable (target range 0–20)
}

function slopScoreLabel(score: number, warn: number, error: number): string {
	if (score >= error) { return '🔴 high slop — consider lighter models'; }
	if (score >= warn) { return '🟡 moderate slop'; }
	return '🟢 efficient';
}

// ── Budget Configuration ─────────────────────────────────────────────

type SlopCostConfig = {
	dailyBudgetUsd: number;
	weeklyBudgetUsd: number;
	alertThresholdPct: number;
	environment: string;
};

const DEFAULT_CONFIG: SlopCostConfig = {
	dailyBudgetUsd: 1.00,
	weeklyBudgetUsd: 5.00,
	alertThresholdPct: 80,
	environment: 'dev',
};

async function readSlopCostConfig(): Promise<SlopCostConfig> {
	const vscConfig = vscode.workspace.getConfiguration('slopcost');

	// Try .slopcost file in workspace root first
	const files = await vscode.workspace.findFiles('.slopcost', null, 1);
	if (files.length > 0) {
		try {
			const raw = await vscode.workspace.fs.readFile(files[0]);
			const json = JSON.parse(Buffer.from(raw).toString('utf8'));
			return {
				dailyBudgetUsd: json.dailyBudgetUsd ?? vscConfig.get('budget.daily', DEFAULT_CONFIG.dailyBudgetUsd),
				weeklyBudgetUsd: json.weeklyBudgetUsd ?? vscConfig.get('budget.weekly', DEFAULT_CONFIG.weeklyBudgetUsd),
				alertThresholdPct: json.alertThresholdPct ?? vscConfig.get('budget.alertPct', DEFAULT_CONFIG.alertThresholdPct),
				environment: json.environment ?? vscConfig.get('environment', DEFAULT_CONFIG.environment),
			};
		} catch {
			// Malformed .slopcost — fall through to VS Code settings
		}
	}

	return {
		dailyBudgetUsd: vscConfig.get('budget.daily', DEFAULT_CONFIG.dailyBudgetUsd),
		weeklyBudgetUsd: vscConfig.get('budget.weekly', DEFAULT_CONFIG.weeklyBudgetUsd),
		alertThresholdPct: vscConfig.get('budget.alertPct', DEFAULT_CONFIG.alertThresholdPct),
		environment: vscConfig.get('environment', DEFAULT_CONFIG.environment),
	};
}

function getTodayDate(): string {
	return new Date().toISOString().split('T')[0];
}

function offsetDate(days: number): string {
	const d = new Date();
	d.setDate(d.getDate() + days);
	return d.toISOString().split('T')[0];
}

type DateRange = { start: string; end: string; label: string };

// Show a QuickPick to choose a date range.
// Returns undefined if the user cancels at any point.
async function pickDateRange(): Promise<DateRange | undefined> {
	const today = getTodayDate();

	const choice = await vscode.window.showQuickPick(
		[
			{ label: '$(calendar) Today', detail: today },
			{ label: '$(history) Yesterday', detail: offsetDate(-1) },
			{ label: '$(graph-line) Last 7 days', detail: `${offsetDate(-6)} → ${today}` },
			{ label: '$(graph-line) Last 30 days', detail: `${offsetDate(-29)} → ${today}` },
			{ label: '$(edit) Custom date…', detail: 'Enter a specific YYYY-MM-DD date' },
		],
		{ placeHolder: 'Select date range', title: 'SlopCost: Date Range', ignoreFocusOut: true }
	);
	if (!choice) { return undefined; }

	const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

	if (choice.label.includes('Today')) {
		return { start: today, end: today, label: `Today (${today})` };
	}
	if (choice.label.includes('Yesterday')) {
		const d = offsetDate(-1);
		return { start: d, end: d, label: `Yesterday (${d})` };
	}
	if (choice.label.includes('7 days')) {
		return { start: offsetDate(-6), end: today, label: 'Last 7 days' };
	}
	if (choice.label.includes('30 days')) {
		return { start: offsetDate(-29), end: today, label: 'Last 30 days' };
	}

	// Custom: ask for a specific date
	const input = await vscode.window.showInputBox({
		prompt: 'Enter date (YYYY-MM-DD)',
		placeHolder: today,
		value: today,
		ignoreFocusOut: true,
		validateInput: v =>
			ISO_RE.test(v) && !isNaN(Date.parse(v))
				? null
				: 'Must be a valid date in YYYY-MM-DD format',
	});
	if (!input) { return undefined; }
	return { start: input, end: input, label: `Custom (${input})` };
}

// Client-side date filter — belt-and-suspenders in case
// the backend does not support start_date/end_date params.
function inRange(date: string, start: string, end: string): boolean {
	return date >= start && date <= end;
}


// ── Output Channel Formatter ──────────────────────────────
// Brand mark: [>$] — the terminal icon from slopcost-icon.svg in ASCII.
// Plain unicode only — no ANSI, renders correctly in VS Code Output Channel.
const HR = `  ${'─'.repeat(41)}`;
const fmt = {

	// Three-line brand header
	//   ┌──┐
	//   |>$|  SlopCost
	//   └──┘  v0.0.1 · report-name
	brand(subtitle: string): string[] {
		return [
			'  ┌──┐',
			'  |>$|  SlopCost',
			`  └──┘  ${subtitle}`,
		];
	},

	hr(): string { return HR; },
	blank(): string { return ''; },

	// ··· between sections
	sep(): string { return '  ···'; },

	// lowercase label  value
	field(label: string, value: string): string {
		return `  ${label.padEnd(13)}${value}`;
	},

	// section heading (no ▸ — clean lowercase)
	section(title: string): string { return `  ${title}`; },

	// 1  item text  (space-separated, not dot-separated)
	listItem(i: number, text: string): string {
		return `  ${i + 1}  ${text}`;
	},

	// Plain text line (used for summary, hints)
	hint(text: string): string { return `  ${text}`; },

	// Tabular layout — by-model
	tableHeader(): string {
		return `  ${'model'.padEnd(26)}${'cost'.padEnd(11)}${'tokens'.padEnd(10)}reqs`;
	},
	tableDivider(): string {
		return `  ${'·'.repeat(24)}  ${'·'.repeat(9)}  ${'·'.repeat(8)}  ${'·'.repeat(4)}`;
	},
	tableRow(model: string, cost: string, tokens: string, reqs: string): string {
		return `  ${model.substring(0, 25).padEnd(26)}${cost.padEnd(11)}${tokens.padEnd(10)}${reqs}`;
	},

	// Tabular layout — by-endpoint
	endpointHeader(): string {
		return `  ${'endpoint'.padEnd(32)}${'cost'.padEnd(11)}${'tokens'.padEnd(10)}reqs`;
	},
	endpointRow(ep: string, cost: string, tokens: string, reqs: string): string {
		return `  ${ep.substring(0, 31).padEnd(32)}${cost.padEnd(11)}${tokens.padEnd(10)}${reqs}`;
	},

	header(title: string): string {
		return `\n${HR}\n  ${title.toUpperCase()}\n${HR}`;
	},
	softDivider(): string {
		return `  ${'·'.repeat(41)}`;
	},
	sectionHead(title: string): string {
		return `  ${title.toLowerCase()}`;
	},
	warn(text: string): string {
		return `  ! ${text}`;
	},
	body(text: string): string {
		return `    ${text}`;
	},
	alertField(label: string, value: string): string {
		return `  !! ${label.padEnd(13)}${value}`;
	},
	costField(label: string, value: string): string {
		return `  $$ ${label.padEnd(13)}${value}`;
	},
	footer(text: string): string {
		return `\n${HR}\n  ${text}\n${HR}\n`;
	},

	// Print lines and reveal channel
	print(ch: vscode.OutputChannel, lines: string[]): void {
		ch.clear();
		lines.forEach(l => ch.appendLine(l));
		ch.show(true);
	},
};

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "slopcost" is now active!');

	let session = createSession();

	const disposable = vscode.commands.registerCommand('aiCost.configureApiKey', async () => {
		const apiKey = await vscode.window.showInputBox({
			prompt: 'Enter your AI Cost API Key',
			placeHolder: 'sk_live_...',
			password: true,
			ignoreFocusOut: true
		});

		if (!apiKey) {
			vscode.window.showWarningMessage('API key configuration cancelled.');
			return;
		}

		if (!apiKey.startsWith('sk_live_')) {
			vscode.window.showErrorMessage('Invalid API Key format. It must start with "sk_live_".');
			return;
		}

		await context.secrets.store('aiCostOptimizer.apiKey', apiKey);
		vscode.window.showInformationMessage('AI Cost API Key stored securely.');
	});

	const showTodayCostCmd = vscode.commands.registerCommand('aiCost.showTodayCost', async () => {
		if (!outputChannel) {
			outputChannel = vscode.window.createOutputChannel('Slop Cost');
		}

		const range = await pickDateRange();
		if (!range) { return; } // cancelled

		try {
			const apiKey = await context.secrets.get('aiCostOptimizer.apiKey');
			if (!apiKey) {
				vscode.window.showWarningMessage('SlopCost: No API key configured.');
				return;
			}
			const rows = await callApi<DailyCost[]>(
				apiKey,
				`/analytics/daily-cost?start_date=${range.start}&end_date=${range.end}`
			);
			// Client-side filter as safety net
			const filtered = rows.filter(r => inRange(r.date, range.start, range.end));

			const lines: string[] = [
				...fmt.brand(`v0.0.1 · daily-cost · ${range.label}`),
				fmt.hr(),
				fmt.blank(),
			];
			if (filtered.length === 0) {
				lines.push(fmt.hint(`no cost data found for ${range.label}.`));
			} else {
				filtered.forEach((row, i) => {
					if (i > 0) { lines.push(fmt.blank()); }
					lines.push(
						fmt.field('date', row.date),
						fmt.field('environment', row.environment),
						fmt.field('total cost', `$${Number(parseFloat(row.total_cost_usd).toFixed(4)).toString()} USD`),
						fmt.field('tokens used', row.total_tokens.toLocaleString()),
						fmt.field('requests', row.request_count.toLocaleString()),
					);
				});
			}
			lines.push(
				fmt.blank(),
				fmt.hr(),
				fmt.hint("run  SlopCost: Explain Today's Cost  for a breakdown"),
			);
			fmt.print(outputChannel, lines);
		} catch {
			// callApi already shows user-facing errors
		}
	});

	const explainTodayCostCmd = vscode.commands.registerCommand('aiCost.explainTodayCost', async () => {
		if (!outputChannel) {
			outputChannel = vscode.window.createOutputChannel('Slop Cost');
		}

		try {
			const date = getTodayDate();
			const apiKey = await context.secrets.get('aiCostOptimizer.apiKey');
			if (!apiKey) {
				vscode.window.showWarningMessage('SlopCost: No API key configured.');
				return;
			}
			const data = await callApi<CostExplanation>(apiKey, `/ai/explain/daily-cost?date=${date}&environment=dev`);

			const lines: string[] = [
				...fmt.brand(`v0.0.1 · explain-cost · ${data.date}`),
				fmt.hr(),
				fmt.blank(),
				fmt.section('summary'),
				fmt.hint(data.summary),
				fmt.blank(),
				fmt.sep(),
				fmt.blank(),
				fmt.section('key drivers'),
				...data.key_drivers.map((d, i) => fmt.listItem(i, d)),
				fmt.blank(),
				fmt.sep(),
				fmt.blank(),
				fmt.section('recommendations'),
				...data.recommendations.map((r, i) => fmt.listItem(i, r)),
				fmt.blank(),
				fmt.hr(),
			];
			fmt.print(outputChannel, lines);
		} catch {
			// callApi already shows user-facing errors
		}
	});

	// ── Show Cost By Model ───────────────────────────────
	const showByModelCmd = vscode.commands.registerCommand('aiCost.showByModel', async () => {
		if (!outputChannel) {
			outputChannel = vscode.window.createOutputChannel('Slop Cost');
		}

		const range = await pickDateRange();
		if (!range) { return; }

		try {
			const apiKey = await context.secrets.get('aiCostOptimizer.apiKey');
			if (!apiKey) {
				vscode.window.showWarningMessage('SlopCost: No API key configured.');
				return;
			}
			const rows = await callApi<CostByModel[]>(
				apiKey,
				`/analytics/by-model?start_date=${range.start}&end_date=${range.end}`
			);
			const filtered = rows.filter(r => inRange(r.date, range.start, range.end));
			const lines: string[] = [
				...fmt.brand(`v0.0.1 · by-model · ${range.label}`),
				fmt.hr(),
				fmt.blank(),
			];
			if (filtered.length === 0) {
				lines.push(fmt.hint('no data found for this range.'));
			} else {
				lines.push(fmt.tableHeader(), fmt.tableDivider());
				filtered.forEach(row => {
					lines.push(fmt.tableRow(
						row.model_name,
						`$${Number(parseFloat(row.total_cost_usd).toFixed(4)).toString()}`,
						row.total_tokens.toLocaleString(),
						row.request_count.toLocaleString(),
					));
				});
				// Totals row
				const totalCost = filtered.reduce((s, r) => s + parseFloat(r.total_cost_usd), 0);
				const totalTokens = filtered.reduce((s, r) => s + r.total_tokens, 0);
				const totalReqs = filtered.reduce((s, r) => s + r.request_count, 0);
				lines.push(
					fmt.tableDivider(),
					fmt.tableRow('total', `$${Number(totalCost.toFixed(4)).toString()}`, totalTokens.toLocaleString(), totalReqs.toLocaleString()),
				);
			}
			lines.push(fmt.blank(), fmt.hr());
			fmt.print(outputChannel, lines);
		} catch {
			// callApi already shows user-facing errors
		}
	});

	// ── Show Cost By Endpoint ────────────────────────────
	const showByEndpointCmd = vscode.commands.registerCommand('aiCost.showByEndpoint', async () => {
		if (!outputChannel) {
			outputChannel = vscode.window.createOutputChannel('Slop Cost');
		}

		const range = await pickDateRange();
		if (!range) { return; }

		try {
			const apiKey = await context.secrets.get('aiCostOptimizer.apiKey');
			if (!apiKey) {
				vscode.window.showWarningMessage('SlopCost: No API key configured.');
				return;
			}
			const rows = await callApi<CostByEndpoint[]>(
				apiKey,
				`/analytics/by-endpoint?start_date=${range.start}&end_date=${range.end}`
			);
			const filtered = rows.filter(r => inRange(r.date, range.start, range.end));
			const lines: string[] = [
				...fmt.brand(`v0.0.1 · by-endpoint · ${range.label}`),
				fmt.hr(),
				fmt.blank(),
			];
			if (filtered.length === 0) {
				lines.push(fmt.hint('no data found for this range.'));
			} else {
				lines.push(fmt.endpointHeader(), fmt.tableDivider());
				filtered.forEach(row => {
					lines.push(fmt.endpointRow(
						row.endpoint,
						`$${Number(parseFloat(row.total_cost_usd).toFixed(4)).toString()}`,
						row.total_tokens.toLocaleString(),
						row.request_count.toLocaleString(),
					));
				});
				// Totals row
				const totalCost = filtered.reduce((s, r) => s + parseFloat(r.total_cost_usd), 0);
				const totalTokens = filtered.reduce((s, r) => s + r.total_tokens, 0);
				const totalReqs = filtered.reduce((s, r) => s + r.request_count, 0);
				lines.push(
					fmt.tableDivider(),
					fmt.endpointRow('total', `$${Number(totalCost.toFixed(4)).toString()}`, totalTokens.toLocaleString(), totalReqs.toLocaleString()),
				);
			}
			lines.push(fmt.blank(), fmt.hr());
			fmt.print(outputChannel, lines);
		} catch {
			// callApi already shows user-facing errors
		}
	});

	// ── Show Session Stats ───────────────────────────────
	const showSessionStatsCmd = vscode.commands.registerCommand('aiCost.showSessionStats', async () => {

		const slopScore = computeSlopScore(session);
		const config = vscode.workspace.getConfiguration('slopcost');
		const warn = config.get<number>('thresholds.warning', 5.0);
		const error = config.get<number>('thresholds.error', 10.0);

		const durationMs = Date.now() - session.startedAt.getTime();
		const durationMinutes = Math.floor(durationMs / 60_000);
		const durationDisplay = durationMinutes < 1
			? 'less than a minute'
			: `${durationMinutes} min`;

		if (!outputChannel) {
			outputChannel = vscode.window.createOutputChannel('Slop Cost');
		}

		const lines: string[] = [];
		lines.push(...fmt.brand(`v0.0.1 · session-stats · this window`));
		lines.push(fmt.header('session efficiency'));

		lines.push(fmt.field('duration', durationDisplay));
		lines.push(fmt.field('recommendations', session.recommendationCount.toString()));
		lines.push(fmt.field('tokens (est)', session.totalTokensEstimated.toLocaleString()));

		lines.push(fmt.blank());
		lines.push(fmt.softDivider());
		lines.push(fmt.blank());

		lines.push(fmt.sectionHead('category breakdown'));
		for (const [cat, count] of Object.entries(session.categoryBreakdown)) {
			if (count === 0) { continue; }
			const pct = Math.round((count / session.recommendationCount) * 100);
			const bar = '█'.repeat(Math.round(pct / 5)).padEnd(20);
			const isHeavy = (cat === 'HIGH_REASONING' || cat === 'CODE') && pct > 50;
			const row = `${cat.padEnd(16)} ${bar}  ${count}x  (${pct}%)`;
			if (isHeavy) {
				lines.push(fmt.warn(row));
			} else {
				lines.push(fmt.body(row));
			}
		}

		lines.push(fmt.blank());
		lines.push(fmt.softDivider());
		lines.push(fmt.blank());

		fmt.sectionHead('by file (this session)');
		const sortedFiles = [...session.fileBreakdown.entries()]
			.sort((a, b) => b[1].tokens - a[1].tokens)  // heaviest first
			.slice(0, 5);                                 // top 5 only — keep output clean

		for (const [file, stats] of sortedFiles) {
			lines.push(fmt.body(`  ${file.padEnd(30)} ${stats.tokens.toLocaleString().padStart(8)} tokens   ${stats.recommendations}x`));
		}

		lines.push(fmt.blank());
		lines.push(fmt.softDivider());
		lines.push(fmt.blank());

		if (slopScore === null) {
			lines.push(fmt.body('slop score      not enough data yet (minimum 3 recommendations)'));
		} else {
			lines.push(fmt.field("slop score (now)", slopScore?.toFixed(1) ?? "n/a"));
			lines.push(fmt.field("slop score (peak)", session.peakSlopScore.toFixed(1)));

			const label = slopScoreLabel(session.peakSlopScore, warn, error);
			if (session.peakSlopScore >= error) {
				lines.push(fmt.blank());
				lines.push(fmt.alertField('slop status', label));
				lines.push(fmt.hint('heavy model usage detected — review category breakdown above'));
				lines.push(fmt.hint('consider: swap HIGH_REASONING tasks → CODE or FAST models'));
			} else if (session.peakSlopScore >= warn) {
				lines.push(fmt.costField('slop status', label));
			} else {
				lines.push(fmt.field('slop status', label));
			}
		}

		lines.push(fmt.footer("run 'SlopCost: Show Today's Cost' for backend spend data"));

		fmt.print(outputChannel, lines);
	});

	// ── Configure Available Models ─────────────────────────
	const configModelsCmd = vscode.commands.registerCommand('aiCost.configureAvailableModels', async () => {
		const currentEnabled = getEnabledModels(context);

		// IDE Groups for cleaner navigation
		const ideGroups = ['Antigravity', 'Cursor', 'Copilot', 'JetBrains', 'Windsurf', 'BYOK'];
		const items: (vscode.QuickPickItem & { modelId?: string })[] = [];

		for (const ide of ideGroups) {
			items.push({
				label: ide,
				kind: vscode.QuickPickItemKind.Separator
			});

			const modelsInGroup = MODEL_DIRECTORY.filter(m => m.ideFocus.includes(ide));
			for (const m of modelsInGroup) {
				items.push({
					label: m.id,
					modelId: m.id,
					description: `(${m.access})`,
					picked: currentEnabled.includes(m.id),
				});
			}
		}

		const selected = await vscode.window.showQuickPick(items, {
			canPickMany: true,
			placeHolder: 'Select models available in your current environment',
			title: 'SlopCost: Configure Models',
			ignoreFocusOut: true,
		});

		if (!selected) { return; }

		const newEnabled = selected.map(s => s.modelId).filter((id): id is string => !!id);
		const toStore = newEnabled.length > 0 ? newEnabled : DEFAULT_ENABLED_MODELS;
		await context.globalState.update(ENABLED_MODELS_KEY, toStore);

		const count = toStore.length;
		vscode.window.showInformationMessage(
			`SlopCost: ${count} model${count === 1 ? '' : 's'} enabled across ${selected.length} selections.`
		);

		updateRecommendation();
	});

	// ── Local Proxy Configuration ────────────────────────────
	const PROXY_PORT = vscode.workspace.getConfiguration('slopcost').get<number>('proxyPort', 9999);

	const PROVIDER_TARGETS: Record<string, { host: string; port: number }> = {
		'/anthropic': { host: 'api.anthropic.com', port: 443 },
		'/openai': { host: 'api.openai.com', port: 443 },
		'/google': { host: 'generativelanguage.googleapis.com', port: 443 },
		'/groq': { host: 'api.groq.com', port: 443 },
		'/deepseek': { host: 'api.deepseek.com', port: 443 },
	};

	// Compute workspace ID once — hashed, never the raw path
	const workspaceId = (() => {
		const raw = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? 'unknown';
		let hash = 0;
		for (let i = 0; i < raw.length; i++) {
			hash = (Math.imul(31, hash) + raw.charCodeAt(i)) | 0;
		}
		return Math.abs(hash).toString(16);
	})();

	const startProxyCmd = vscode.commands.registerCommand('aiCost.startProxy', async () => {
		if (proxyServer) {
			vscode.window.showInformationMessage(`SlopCost proxy already running on port ${PROXY_PORT}.`);
			return;
		}

		const handler = createProxyHandler(
			context, session, statusBarItem, workspaceId, PROVIDER_TARGETS
		);

		proxyServer = http.createServer(handler);

		proxyServer.listen(PROXY_PORT, '127.0.0.1', () => {
			(async () => {
				const msg = await vscode.window.showInformationMessage(
					`SlopCost proxy running on 127.0.0.1:${PROXY_PORT}. Point your AI tool base URL at http://localhost:${PROXY_PORT}/{provider}`,
					'Copy Anthropic URL', 'Copy OpenAI URL'
				);
				if (msg === 'Copy Anthropic URL') {
					vscode.env.clipboard.writeText(`http://localhost:${PROXY_PORT}/anthropic`);
				}
				if (msg === 'Copy OpenAI URL') {
					vscode.env.clipboard.writeText(`http://localhost:${PROXY_PORT}/openai`);
				}
			})();
			statusBarItem.text = '$(radio-tower) SlopCost';
		});

		proxyServer.on('error', (err: any) => {
			if (err.code === 'EADDRINUSE') {
				vscode.window.showErrorMessage(
					`Port ${PROXY_PORT} is in use. Change slopcost.proxyPort in settings.`
				);
			} else {
				vscode.window.showErrorMessage(`SlopCost proxy error: ${err.message}`);
			}
			proxyServer = null;
		});
	});

	const stopProxyCmd = vscode.commands.registerCommand('aiCost.stopProxy', () => {
		if (!proxyServer) {
			vscode.window.showInformationMessage('SlopCost proxy is not running.');
			return;
		}
		proxyServer.close(() => {
			proxyServer = null;
			statusBarItem.text = 'SlopCost';
			vscode.window.showInformationMessage('SlopCost proxy stopped.');
		});
	});

	context.subscriptions.push(
		disposable, showTodayCostCmd, explainTodayCostCmd,
		showByModelCmd, showByEndpointCmd, configModelsCmd,
		showSessionStatsCmd, startProxyCmd, stopProxyCmd
	);

	// ── Activity Bar: TreeView ────────────────────────────────
	const treeProvider = new SlopCostTreeDataProvider();
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('slopcost.overview', treeProvider)
	);

	// ── Status Bar: Model Recommendation ──────────────────

	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.text = '$(lightbulb) SlopCost: Waiting for prompt...';
	statusBarItem.tooltip = 'Open a file and start typing to get a model recommendation.';
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);

	// ── Debounced Editor Listener ─────────────────────────

	async function updateRecommendation() {
		const editor = vscode.window.activeTextEditor;

		// No editor open → idle state
		if (!editor) {
			statusBarItem.text = '$(lightbulb) SlopCost: No editor open';
			statusBarItem.tooltip = 'Open a file and start typing to get a model recommendation.';
			return;
		}

		// Selection-first: user selection is a strong intent signal.
		// If the user explicitly highlights text, they want a recommendation
		// for THAT text, not the entire file (which may be thousands of lines
		// of irrelevant code). Primary selection only for v0.1.
		const selection = editor.selection;
		const hasSelection = !selection.isEmpty;
		const text = hasSelection
			? editor.document.getText(selection).trim()
			: editor.document.getText().trim();
		const source = hasSelection ? 'selected text' : 'full document';

		// Empty → waiting state
		if (text.length === 0) {
			statusBarItem.text = '$(lightbulb) SlopCost: Start typing...';
			statusBarItem.tooltip = 'Type a prompt or code to get a real-time model recommendation.';
			return;
		}

		// Too short to meaningfully analyze (< 10 chars)
		if (text.length < 10) {
			statusBarItem.text = '$(lightbulb) SlopCost: Keep typing...';
			statusBarItem.tooltip = 'Need a bit more text for an accurate recommendation.';
			return;
		}

		const features = extractPromptFeatures(text);
		const enabledModels = getEnabledModels(context);
		const rec = recommendModel(features, enabledModels);

		// ── Session accumulation ───────────────────────────────────────────────────

		// Accumulate this update into the session
		session.totalTokensEstimated += features.estimatedTokens;
		session.recommendationCount += 1;
		session.categoryBreakdown[rec.category] += 1;
		session.weightedCategorySum += CATEGORY_WEIGHTS[rec.category];

		// Per-file tracking
		const fileName = editor.document.fileName;
		const fileLabel = fileName.split(/[\\/]/).pop() ?? 'unknown'; // basename only
		const existing = session.fileBreakdown.get(fileLabel) ?? { tokens: 0, recommendations: 0 };
		session.fileBreakdown.set(fileLabel, {
			tokens: existing.tokens + features.estimatedTokens,
			recommendations: existing.recommendations + 1,
		});

		// ── Ingest to Backend ──────────────────────────────────────────────────────

		// Ingest to backend if API key is configured — non-blocking
		const apiKey = await context.secrets.get('aiCostOptimizer.apiKey');
		if (apiKey) {
			const workspaceId = (() => {
				// Hash the workspace path — never send the raw path
				const raw = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? 'unknown';
				let hash = 0;
				for (let i = 0; i < raw.length; i++) {
					hash = (Math.imul(31, hash) + raw.charCodeAt(i)) | 0;
				}
				return Math.abs(hash).toString(16);
			})();

			const env = vscode.workspace.getConfiguration('slopcost').get<string>('environment', 'dev');
			ingestUsage(apiKey, {
				provider: deriveProvider(rec.model),
				modelName: rec.model,
				inputTokens: features.estimatedTokens,
				outputTokens: 0,
				latencyMs: 0,
				endpoint: 'heuristic',
				environment: env,
				metadata: {
					intent: features.intent,
					category: rec.category,
					workspaceId,
					source: 'status-bar-recommender',
				},
			});
			// Intentionally NOT awaited — fire and forget
		}

		// ── Slop Score ─────────────────────────────────────────────────────────────

		const slopScore = computeSlopScore(session);

		if (slopScore !== null && slopScore > session.peakSlopScore) {
			session.peakSlopScore = slopScore;
		}

		// Read thresholds from config (user-overridable via settings.json or .slopcost)
		const config = vscode.workspace.getConfiguration('slopcost');
		const warnThreshold = config.get<number>('thresholds.warning', 5.0);
		const errorThreshold = config.get<number>('thresholds.error', 10.0);

		// Colour driven by peak, not current — status bar never goes green mid-session
		const scoreForColor = session.peakSlopScore > 0
			? session.peakSlopScore
			: (slopScore ?? 0);

		if (slopScore === null) {
			// Not enough data yet — stay neutral, hint in tooltip
			statusBarItem.backgroundColor = undefined;
		} else if (scoreForColor >= errorThreshold) {
			statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
		} else if (scoreForColor >= warnThreshold) {
			statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
		} else {
			statusBarItem.backgroundColor = undefined;
		}

		// Keep status bar text short; tooltip has full detail
		const shortReason = rec.reason.length > 30
			? rec.reason.substring(0, 27) + '...'
			: rec.reason;

		statusBarItem.text = `$(lightbulb) SlopCost: ${rec.model} (${shortReason})`;

		// Tooltip construction
		const scoreDisplay = slopScore === null
			? 'Slop Score: gathering data...'
			: `Slop Score: ${slopScore.toFixed(1)}  (peak: ${session.peakSlopScore.toFixed(1)})`;

		statusBarItem.tooltip = [
			`Recommended model: ${rec.model}`,
			`Reason: ${rec.reason}`,
			`Confidence: ${rec.confidence}`,
			`Based on: ${source}`,
			'',
			`Tokens: ~${features.estimatedTokens} | Intent: ${features.intent}`,
			`Enabled models: ${enabledModels.length}`,
			'',
			scoreDisplay
		].join('\n');
	}

	function scheduleUpdate() {
		if (debounceTimer) { clearTimeout(debounceTimer); }
		// 400ms debounce prevents excessive computation while typing/selecting
		debounceTimer = setTimeout(updateRecommendation, 400);
	}

	// Three listeners cover all relevant state changes:
	//   1. Text edits          → re-analyze content
	//   2. Selection changes   → switch between selection and full-doc analysis
	//   3. Editor switches     → new document context
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument((e) => {
			const activeDoc = vscode.window.activeTextEditor?.document;
			if (activeDoc && e.document === activeDoc) {
				scheduleUpdate();
			}
		}),
		vscode.window.onDidChangeTextEditorSelection(scheduleUpdate),
		vscode.window.onDidChangeActiveTextEditor(scheduleUpdate)
	);

	// Initial run for the currently active editor
	updateRecommendation();

	// ── Check Budget Command ──────────────────────────────────
	context.subscriptions.push(
		vscode.commands.registerCommand('aiCost.checkBudget', async () => {
			const apiKey = await context.secrets.get('aiCostOptimizer.apiKey');
			if (!apiKey) {
				vscode.window.showWarningMessage('SlopCost: No API key configured. Run "SlopCost: Configure API Key" first.');
				return;
			}

			const config = await readSlopCostConfig();

			if (!outputChannel) {
				outputChannel = vscode.window.createOutputChannel('Slop Cost');
			}

			let dailyCosts: DailyCost[];
			try {
				dailyCosts = await callApi<DailyCost[]>(apiKey, '/analytics/daily-cost');
			} catch {
				return;
			}

			const today = new Date().toISOString().split('T')[0];
			const todayData = dailyCosts.find(d => d.date === today);
			const spentUsd = todayData ? parseFloat(todayData.total_cost_usd) : 0;
			const budget = config.dailyBudgetUsd;
			const pct = budget > 0 ? Math.round((spentUsd / budget) * 100) : 0;
			const remaining = Math.max(budget - spentUsd, 0);

			// ── Output Channel report ────────────────────────────────────────────
			const lines: string[] = [];
			lines.push(...fmt.brand(`v0.0.1 · budget-check · ${today}`));
			lines.push(fmt.header('budget check'));

			if (pct >= 100) {
				lines.push(fmt.alertField('status', '✖  daily budget exceeded'));
			} else if (pct >= config.alertThresholdPct) {
				lines.push(fmt.costField('status', `⚠  approaching daily budget (${pct}% used)`));
			} else {
				lines.push(fmt.field('status', `✓  within budget (${pct}% used)`));
			}

			lines.push(fmt.blank());
			lines.push(fmt.field('budget limit', `$${budget.toFixed(2)} USD / day`));

			if (pct >= config.alertThresholdPct) {
				lines.push(fmt.costField('spent today', `$${spentUsd.toFixed(4)} USD  (${pct}%)`));
			} else {
				lines.push(fmt.field('spent today', `$${spentUsd.toFixed(4)} USD  (${pct}%)`));
			}

			lines.push(fmt.field('remaining', `$${remaining.toFixed(4)} USD`));
			lines.push(fmt.footer(`configured in .slopcost · limit: $${budget.toFixed(2)}/day`));

			fmt.print(outputChannel, lines);

			// ── Notification toast ────────────────────────────────────────────────
			if (pct >= 100) {
				const choice = await vscode.window.showErrorMessage(
					`SlopCost: Daily budget exceeded ($${spentUsd.toFixed(4)} / $${budget.toFixed(2)})`,
					'Show Breakdown', 'Explain Cost'
				);
				if (choice === 'Show Breakdown') {
					vscode.commands.executeCommand('aiCost.showByModel');
				}
				if (choice === 'Explain Cost') {
					vscode.commands.executeCommand('aiCost.explainTodayCost');
				}
			} else if (pct >= config.alertThresholdPct) {
				const choice = await vscode.window.showWarningMessage(
					`SlopCost: ${pct}% of daily budget used ($${spentUsd.toFixed(4)} / $${budget.toFixed(2)})`,
					'Show Breakdown'
				);
				if (choice === 'Show Breakdown') {
					vscode.commands.executeCommand('aiCost.showByModel');
				}
			}
		})
	);

	// ── Auto Budget Check on Startup ──────────────────────────
	// Silent unless threshold is crossed
	(async () => {
		const apiKey = await context.secrets.get('aiCostOptimizer.apiKey');
		if (!apiKey) { return; }

		try {
			const config = await readSlopCostConfig();
			const dailyCosts = await callApi<DailyCost[]>(apiKey, '/analytics/daily-cost');
			const today = new Date().toISOString().split('T')[0];
			const todayData = dailyCosts.find(d => d.date === today);
			const spentUsd = todayData ? parseFloat(todayData.total_cost_usd) : 0;
			const pct = config.dailyBudgetUsd > 0
				? Math.round((spentUsd / config.dailyBudgetUsd) * 100)
				: 0;

			if (pct >= 100) {
				vscode.window.showErrorMessage(
					`SlopCost: Daily budget already exceeded at startup ($${spentUsd.toFixed(4)} / $${config.dailyBudgetUsd.toFixed(2)})`,
					'Show Details'
				).then(c => {
					if (c === 'Show Details') {
						vscode.commands.executeCommand('aiCost.checkBudget');
					}
				});
			} else if (pct >= config.alertThresholdPct) {
				vscode.window.showWarningMessage(
					`SlopCost: ${pct}% of today's budget already used`,
					'Show Details'
				).then(c => {
					if (c === 'Show Details') {
						vscode.commands.executeCommand('aiCost.checkBudget');
					}
				});
			}
		} catch {
			// Backend unreachable at startup — fail silently
		}
	})();
}

// This method is called when your extension is deactivated
export function deactivate() {
	if (proxyServer) {
		proxyServer.close();
		proxyServer = null;
	}
}

function createProxyHandler(
	context: vscode.ExtensionContext,
	session: SessionState,
	statusBar: vscode.StatusBarItem,
	workspaceId: string,
	providerTargets: Record<string, { host: string; port: number }>
): http.RequestListener {

	return async (req: http.IncomingMessage, res: http.ServerResponse) => {
		try {

			// ── Route: determine provider from path prefix ────────────────────────
			const urlPath = req.url ?? '/';
			const provider = Object.keys(providerTargets).find(p => urlPath.startsWith(p));

			if (!provider) {
				res.writeHead(404);
				res.end(JSON.stringify({
					error: 'Unknown provider. Use /anthropic, /openai, /google, /groq, or /deepseek'
				}));
				return;
			}

			const target = providerTargets[provider];
			const targetPath = urlPath.slice(provider.length) || '/';

			// ── Collect request body ──────────────────────────────────────────────
			// PRIVACY: parsed once to extract model name only. Buffer is forwarded
			// to provider and then goes out of scope. Never stored anywhere.
			const bodyChunks: Buffer[] = [];
			for await (const chunk of req) {
				bodyChunks.push(chunk as Buffer);
			}
			const bodyBuffer = Buffer.concat(bodyChunks);

			// Extract model name only — never log or store the full body
			let modelId = 'unknown';
			try {
				const parsed = JSON.parse(bodyBuffer.toString('utf8'));
				modelId = typeof parsed.model === 'string' ? parsed.model : 'unknown';
			} catch { /* non-JSON body — pass through */ }

			// ── Forward to provider ───────────────────────────────────────────────
			// PRIVACY: Authorization header is forwarded and never stored beyond
			// this request handler's scope.
			const options: https.RequestOptions = {
				hostname: target.host,
				port: target.port,
				path: targetPath,
				method: req.method,
				headers: { ...req.headers, host: target.host },
			};

			const providerReq = https.request(options, (providerRes) => {

				res.writeHead(providerRes.statusCode ?? 200, providerRes.headers);

				const responseChunks: Buffer[] = [];

				providerRes.on('data', (chunk: Buffer) => {
					res.write(chunk);             // forward immediately to client
					responseChunks.push(chunk);   // buffer for usage extraction only
				});

				providerRes.on('end', async () => {
					res.end();

					// ── Extract usage object ────────────────────────────────────────
					// PRIVACY: we parse the response ONLY to find input/output token counts.
					// Prompt text and response content are never read, stored, or forwarded
					// anywhere other than back to the client.
					let inputTokens = 0;
					let outputTokens = 0;

					try {
						const fullBody = Buffer.concat(responseChunks).toString('utf8');

						// Handle SSE streaming (Anthropic / OpenAI streaming)
						const lines = fullBody.split('\n');
						for (const line of lines) {
							if (!line.startsWith('data: ')) { continue; }
							const data = line.slice(6).trim();
							if (data === '[DONE]') { continue; }
							try {
								const parsed = JSON.parse(data);
								// Anthropic streaming: message_delta event contains usage
								if (parsed.usage) {
									inputTokens = parsed.usage.input_tokens ?? parsed.usage.prompt_tokens ?? inputTokens;
									outputTokens = parsed.usage.output_tokens ?? parsed.usage.completion_tokens ?? outputTokens;
								}
							} catch { /* skip unparseable SSE lines */ }
						}

						// Non-streaming fallback (single JSON response)
						if (inputTokens === 0) {
							try {
								const parsed = JSON.parse(fullBody);
								if (parsed.usage) {
									inputTokens = parsed.usage.input_tokens ?? parsed.usage.prompt_tokens ?? 0;
									outputTokens = parsed.usage.output_tokens ?? parsed.usage.completion_tokens ?? 0;
								}
							} catch { /* not JSON — streaming already handled above */ }
						}
					} catch { /* response parse failed — skip ingest */ }

					if (inputTokens === 0 && outputTokens === 0) { return; }

					// ── Accumulate into session ────────────────────────────────────────
					const totalTokens = inputTokens + outputTokens;
					session.totalTokensEstimated += totalTokens;
					session.recommendationCount += 1;
					session.categoryBreakdown['CODE'] += 1;
					session.weightedCategorySum += CATEGORY_WEIGHTS['CODE'];

					// ── Estimate cost ──────────────────────────────────────────────────
					const costUsd = estimateCost(modelId, inputTokens, outputTokens);

					// ── Update status bar briefly ──────────────────────────────────────
					const prev = statusBar.tooltip?.toString() ?? '';
					statusBar.tooltip =
						`⬤ Last tracked: ${modelId} · in:${inputTokens} out:${outputTokens} · $${costUsd.toFixed(5)}\n\n` + prev;

					// ── Ingest to backend — fire and forget ────────────────────────────
					// PRIVACY: only counts, model name, cost, hashed workspace ID.
					// No prompt text. No response text. No API key.
					const apiKey = await context.secrets.get('aiCostOptimizer.apiKey');
					if (apiKey) {
						const env = vscode.workspace.getConfiguration('slopcost').get<string>('environment', 'dev');
						ingestUsage(apiKey, {
							provider: deriveProvider(modelId),
							modelName: modelId,
							inputTokens,
							outputTokens,
							latencyMs: 0,
							endpoint: targetPath,
							environment: env,
							metadata: {
								workspaceId,
								source: 'proxy',
							},
						});
					}
				});

				providerRes.on('error', () => { res.end(); });
			});

			providerReq.on('error', (err: any) => {
				if (!res.headersSent) {
					res.writeHead(502);
					res.end(JSON.stringify({
						error: 'SlopCost proxy could not reach provider',
						detail: err.message
					}));
				}
			});

			providerReq.write(bodyBuffer);
			providerReq.end();

		} catch (err) {
			// Catch-all — never leave the connection hanging
			if (!res.headersSent) { res.writeHead(500); }
			res.end();
		}
	};
}

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
	// Crude estimation — v1 should use model-specific rates
	const inputRate = 0.000003; // $/token
	const outputRate = 0.000015; // $/token
	return (inputTokens * inputRate) + (outputTokens * outputRate);
}

async function ingestUsage(
	apiKey: string,
	opts: {
		provider: string;
		modelName: string;
		inputTokens: number;
		outputTokens: number;
		latencyMs: number;
		endpoint: string;
		environment: string;
		metadata?: Record<string, unknown>;
	}
): Promise<void> {
	const baseUrl = vscode.workspace.getConfiguration('slopcost').get<string>('backendUrl', 'http://localhost:8000');

	try {
		await fetch(`${baseUrl}/ingest/usage`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				provider: opts.provider,
				model_name: opts.modelName,
				input_tokens: opts.inputTokens,
				output_tokens: opts.outputTokens,
				latency_ms: opts.latencyMs,
				endpoint: opts.endpoint,
				environment: opts.environment,
				...(opts.metadata ? { metadata: opts.metadata } : {}),
			}),
		});
	} catch {
		// Silently swallow — backend being down must never affect the recommender
	}
}

function deriveProvider(modelId: string): string {
	if (modelId.startsWith('claude')) { return 'anthropic'; }
	if (modelId.startsWith('gpt') || modelId.startsWith('o3') || modelId.startsWith('o1')) {
		return 'openai';
	}
	if (modelId.startsWith('gemini')) { return 'google'; }
	if (modelId.startsWith('grok')) { return 'groq'; }
	if (modelId.startsWith('deepseek')) { return 'deepseek'; }
	return 'unknown';
}

async function callApi<T>(
	apiKey: string,
	path: string,
	options?: RequestInit
): Promise<T> {
	const baseUrl = vscode.workspace.getConfiguration('slopcost').get<string>('backendUrl', 'http://localhost:8000');
	const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

	try {
		const response = await fetch(url, {
			...options,
			headers: {
				'Authorization': `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
				...options?.headers
			}
		});

		if (response.status === 401) {
			vscode.window.showErrorMessage('Invalid API Key. Please re-configure your "AI Cost: Configure API Key".');
			throw new Error('Invalid API Key');
		}

		if (response.status === 429) {
			vscode.window.showErrorMessage('Rate limit exceeded. Please try again later.');
			throw new Error('Rate limit exceeded');
		}

		if (!response.ok) {
			vscode.window.showErrorMessage(`API Error: ${response.statusText}`);
			throw new Error(`API Error: ${response.status} ${response.statusText}`);
		}

		return await response.json() as T;
	} catch (error) {
		if (error instanceof Error && error.message.includes('fetch failed')) {
			vscode.window.showErrorMessage('Could not connect to the backend. Is localhost:8000 running?');
			throw new Error('Network Error');
		}
		throw error;
	}
}

// ── Step 1: Prompt Feature Extraction ──────────────────────
// Extracts cheap, local features from raw text.
// No network calls, no LLMs — pure string analysis.

function extractPromptFeatures(text: string): PromptFeatures {
	const lowerText = text.toLowerCase();
	const charLength = text.length;
	// Rough token estimate: ~4 chars per token (GPT-family heuristic)
	const estimatedTokens = Math.ceil(charLength / 4);

	// Code detection: fenced code blocks OR common syntax patterns
	const hasCode = /```/.test(text)
		|| /\b(function|const|let|var|class|import|def |return )\b/.test(text)
		|| /[{};]\s*$/.test(text);

	// Stack trace detection: language-agnostic markers
	const hasStackTrace = /traceback|exception|at line|error:.*line \d+/i.test(text);

	// Intent classification: first keyword match wins
	let intent: PromptFeatures['intent'] = 'other';
	if (/\b(explain|why|how)\b/.test(lowerText)) {
		intent = 'explain';
	} else if (/\b(error|bug|fix)\b/.test(lowerText)) {
		intent = 'debug';
	} else if (/\b(write|generate|create)\b/.test(lowerText)) {
		intent = 'generate';
	} else if (/\b(summarize|tl;dr)\b/.test(lowerText)) {
		intent = 'summarize';
	}

	// Reasoning level: high-complexity indicators take priority
	let reasoningLevel: PromptFeatures['reasoningLevel'] = 'low';
	if (
		/\b(step by step|prove|deep analysis)\b/.test(lowerText)
		|| estimatedTokens > 800
	) {
		reasoningLevel = 'high';
	} else if (hasCode || hasStackTrace) {
		reasoningLevel = 'medium';
	}

	// Latency sensitivity: short prompts or explicit speed keywords
	const latencySensitive = estimatedTokens < 300
		|| /\b(quick|fast|brief)\b/.test(lowerText);

	return {
		charLength,
		estimatedTokens,
		hasCode,
		hasStackTrace,
		intent,
		reasoningLevel,
		latencySensitive,
	};
}

// ── Step 2: Rule-Based Model Recommender ───────────────────
// Top-down priority: first matching rule wins.
// No ML, no network — deterministic mapping from features to model.

function recommendModel(features: PromptFeatures, enabledModels: string[]): ModelRecommendation {

	// Rule 1: Explicit deep reasoning keywords — true high reasoning signal
	// NOT triggered by token count alone — length ≠ complexity
	if (features.reasoningLevel === 'high' && !isLongButSimple(features)) {
		return {
			model: pickFromCategory('HIGH_REASONING', enabledModels),
			reason: 'Deep reasoning or analysis requested',
			confidence: 'high',
			category: 'HIGH_REASONING',
		};
	}

	// Rule 2: Code generation — stronger signal than generic code presence
	if (features.intent === 'generate' && features.hasCode) {
		return {
			model: pickFromCategory('CODE', enabledModels),
			reason: 'Code generation task',
			confidence: 'high',
			category: 'CODE',
		};
	}

	// Rule 3 — lightweight explanation
	if (features.intent === "explain" && features.latencySensitive) {
		return {
			model: pickFromCategory("FAST", enabledModels),
			reason: "quick explanation",
			confidence: "high",
			category: "FAST"
		};
	}

	// Rule 4: Fast code task — code signal but user wants speed
	if ((features.hasCode || features.intent === 'debug') && features.latencySensitive) {
		return {
			model: pickFromCategory('FAST', enabledModels),
			reason: 'Quick code or debug task',
			confidence: 'medium',
			category: 'FAST',
		};
	}

	// Rule 5: Standard code/debug — no speed constraint
	if (features.hasCode || features.intent === 'debug') {
		return {
			model: pickFromCategory('CODE', enabledModels),
			reason: 'Code or debugging task',
			confidence: 'medium',
			category: 'CODE',
		};
	}

	// Rule 6: Explain intent — route by complexity
	if (features.intent === 'explain') {
		const category = features.reasoningLevel === 'high' ? 'HIGH_REASONING' : 'GENERAL';
		return {
			model: pickFromCategory(category, enabledModels),
			reason: 'Explanation task',
			confidence: 'medium',
			category,
		};
	}

	// Rule 7: Summarize or short latency-sensitive → fast
	if (features.intent === 'summarize' || features.latencySensitive) {
		return {
			model: pickFromCategory('FAST', enabledModels),
			reason: features.intent === 'summarize' ? 'Summarization task' : 'Low-latency request',
			confidence: 'high',
			category: 'FAST',
		};
	}

	// Fallback
	return {
		model: pickFromCategory('GENERAL', enabledModels),
		reason: features.estimatedTokens > 100
			? "general task"
			: "no strong signal — try being specific",
		confidence: 'low',
		category: 'GENERAL',
	};
}

// Helper: long token count alone doesn't mean complex reasoning
function isLongButSimple(features: PromptFeatures): boolean {
	return features.estimatedTokens > 800
		&& features.intent !== 'other'
		&& features.reasoningLevel === 'high'
		&& !features.hasCode
		&& !features.hasStackTrace;
}

// ── Activity Bar: SlopCost Panel ──────────────────────────────────────
// Static tree of 4 action nodes — each one fires an existing command.
// This is the skeleton; dynamic data (live cost, model stats) can hang
// off these same nodes in future iterations.

class SlopCostItem extends vscode.TreeItem {
	constructor(
		label: string,
		icon: string,
		commandId: string,
		description?: string
	) {
		super(label, vscode.TreeItemCollapsibleState.None);
		this.iconPath = new vscode.ThemeIcon(icon);
		this.description = description;
		this.command = {
			command: commandId,
			title: label,
		};
		this.tooltip = label;
	}
}

class SlopCostTreeDataProvider implements vscode.TreeDataProvider<SlopCostItem> {
	private readonly nodes: SlopCostItem[] = [
		new SlopCostItem(
			"Today's Cost",
			'graph-line',
			'aiCost.showTodayCost',
			'View spend summary'
		),
		new SlopCostItem(
			'Cost By Model',
			'symbol-misc',
			'aiCost.showByModel',
			'Breakdown per model'
		),
		new SlopCostItem(
			'Cost By Endpoint',
			'symbol-interface',
			'aiCost.showByEndpoint',
			'Breakdown per endpoint'
		),
		new SlopCostItem(
			'Show Session Stats',
			'history',
			'aiCost.showSessionStats',
			'Usage in this window'
		),
		new SlopCostItem(
			'Explain Cost',
			'sparkle',
			'aiCost.explainTodayCost',
			'AI-powered breakdown'
		),
		new SlopCostItem(
			'Configure API Key',
			'key',
			'aiCost.configureApiKey',
			'Set or update key'
		),
		new SlopCostItem(
			'Configure Models',
			'list-filter',
			'aiCost.configureAvailableModels',
			'Pick your available models'
		),
	];

	getTreeItem(element: SlopCostItem): vscode.TreeItem {
		return element;
	}

	getChildren(): SlopCostItem[] {
		return this.nodes;
	}
}