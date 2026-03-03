// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

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

const MODEL_CATALOG = {

	HIGH_REASONING: [
		'claude-opus-4',              // Anthropic — flagship, 200K ctx, Cursor + Copilot + JetBrains
		'claude-opus-4.5',            // Anthropic — improved Opus, Copilot preview + JetBrains BYOK
		'claude-opus-4.6 (Thinking)', // Anthropic — extended thinking mode, Cursor paid
		'gemini-3.1-pro (High)',      // Google    — #1 ARC-AGI-2 (77.1%), Copilot + Windsurf
		'gemini-3-pro',               // Google    — Copilot public preview, Windsurf
		'gpt-5',                      // OpenAI    — Copilot Pro+ + Cursor; top reasoning
		'gpt-oss-120b (High)',        // OpenAI    — open-weight high-reasoning tier, Cursor
		'o3',                         // OpenAI    — reasoning-first, Cursor + Copilot agent mode
	],

	// ── CODE & DEBUGGING ────────────────────────────────────
	// Best for: code generation, PR reviews, bug fixing, stack traces.
	// The daily-driver tier — fast enough for flow, smart enough for hard bugs.
	CODE: [
		'claude-sonnet-4',              // Anthropic — default in Cursor, top SWE-bench
		'claude-sonnet-4.5',            // Anthropic — improved Sonnet, Copilot + JetBrains BYOK
		'claude-sonnet-4.6',            // Anthropic — latest Sonnet, Copilot (premium multiplier TBC)
		'claude-sonnet-4.6 (Thinking)', // Anthropic — thinking mode for harder code tasks, Cursor
		'deepseek-v3',                  // DeepSeek  — free 0x credits in Cursor; strong at code
		'gemini-2.5-pro',               // Google    — Copilot + JetBrains; large ctx coding
		'gemini-3-flash',               // Google    — 78% SWE-bench, free in Windsurf + Cursor
		'gemini-3.1-pro (Low)',         // Google    — low-reasoning tier, speed/quality balance
		'gpt-4.1',                      // OpenAI    — Copilot default (replaced GPT-4o Jun 2025)
		'gpt-5-mini',                   // OpenAI    — Copilot auto-rotation model, chain-of-thought
		'gpt-oss-120b (Medium)',        // OpenAI    — open-weight medium-reasoning, Cursor
		'grok-code-fast-1',             // xAI       — Copilot (zero data retention), fast code tasks
		'swe-1.5',                      // Windsurf  — in-house agentic model; near Claude 4.5 perf
	],

	// ── FAST / LOW LATENCY ───────────────────────────────────
	// Best for: short questions, inline completions, quick edits, "what is X".
	// Prioritise speed over depth — devs reach for these constantly.
	FAST: [
		'claude-haiku-4.5',    // Anthropic — fastest Claude, low latency, Copilot + JetBrains
		'gemini-2.5-flash',    // Google    — fast + large ctx, JetBrains BYOK
		'gemini-3-flash',      // Google    — 3× faster than Gemini 3 Pro, Windsurf free tier
		'gpt-4o',              // OpenAI    — multimodal, VS Code Copilot (only vision model)
		'gpt-4o-mini',         // OpenAI    — cheap + fast, Cursor free tier (500 req/day)
		'gpt-oss-120b (Low)',  // OpenAI    — open-weight low-reasoning = lowest latency, Cursor
		'grok-3-mini',         // xAI       — fast tier, Cursor free
		'raptor-mini',         // GitHub    — Copilot in-house fast model for completions/scripts
		'swe-1-mini',          // Windsurf  — powers Windsurf Tab real-time completions
	],

	// ── GENERAL FALLBACK ─────────────────────────────────────
	// For prompts where no strong signal is detected.
	// Well-rounded models familiar to devs across all four IDEs.
	GENERAL: [
		'claude-sonnet-4',   // Anthropic — Cursor default, broadly trusted
		'gemini-3-flash',    // Google    — fast + capable, available free
		'gpt-4.1',           // OpenAI    — Copilot + Visual Studio default
		'gpt-5.1-codex',     // OpenAI    — Copilot codex model, strong at code + chat
	],
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
};

function createSession(): SessionState {
	return {
		totalTokensEstimated: 0,
		recommendationCount: 0,
		categoryBreakdown: { HIGH_REASONING: 0, CODE: 0, FAST: 0, GENERAL: 0 },
		weightedCategorySum: 0,
		startedAt: new Date(),
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
			const rows = await callApi<DailyCost[]>(
				context,
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
			const data = await callApi<CostExplanation>(context, `/ai/explain/daily-cost?date=${date}&environment=dev`);

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
			const rows = await callApi<CostByModel[]>(
				context,
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
			const rows = await callApi<CostByEndpoint[]>(
				context,
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

		if (slopScore === null) {
			lines.push(fmt.body('slop score      not enough data yet (minimum 3 recommendations)'));
		} else {
			const label = slopScoreLabel(slopScore, warn, error);
			if (slopScore >= error) {
				lines.push(fmt.alertField('slop score', `${slopScore.toFixed(1)}  ${label}`));
				lines.push(fmt.blank());
				lines.push(fmt.hint('  heavy model usage detected — review category breakdown above'));
				lines.push(fmt.hint('  consider: swap HIGH_REASONING tasks → CODE or FAST models'));
			} else if (slopScore >= warn) {
				lines.push(fmt.costField('slop score', `${slopScore.toFixed(1)}  ${label}`));
			} else {
				lines.push(fmt.field('slop score', `${slopScore.toFixed(1)}  ${label}`));
			}
		}

		lines.push(fmt.footer("run 'SlopCost: Show Today's Cost' for backend spend data"));

		fmt.print(outputChannel, lines);
	});

	// ── Configure Available Models ─────────────────────────
	const configModelsCmd = vscode.commands.registerCommand('aiCost.configureAvailableModels', async () => {
		const allModels = [...new Set(Object.values(MODEL_CATALOG).flat())];
		const currentEnabled = getEnabledModels(context);

		const items = allModels.map(model => ({
			label: model,
			picked: currentEnabled.includes(model),
		}));

		const selected = await vscode.window.showQuickPick(items, {
			canPickMany: true,
			placeHolder: 'Select the AI models you have access to',
			title: 'Configure Available Models',
			ignoreFocusOut: true,
		});

		if (!selected) { return; } // cancelled — keep existing config

		const newEnabled = selected.map(s => s.label);
		// If user deselects everything, fall back to defaults silently
		const toStore = newEnabled.length > 0 ? newEnabled : DEFAULT_ENABLED_MODELS;
		await context.globalState.update(ENABLED_MODELS_KEY, toStore);

		const count = toStore.length;
		vscode.window.showInformationMessage(
			`SlopCost: ${count} model${count === 1 ? '' : 's'} enabled.`
		);

		// Immediately refresh recommendation with new model set
		updateRecommendation();
	});

	context.subscriptions.push(
		disposable, showTodayCostCmd, explainTodayCostCmd,
		showByModelCmd, showByEndpointCmd, configModelsCmd,
		showSessionStatsCmd
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

	function updateRecommendation() {
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

		// ── Slop Score ─────────────────────────────────────────────────────────────

		const slopScore = computeSlopScore(session);

		// Read thresholds from config (user-overridable via settings.json or .slopcost)
		const config = vscode.workspace.getConfiguration('slopcost');
		const warnThreshold = config.get<number>('thresholds.warning', 5.0);
		const errorThreshold = config.get<number>('thresholds.error', 10.0);

		if (slopScore === null) {
			// Not enough data yet — stay neutral, hint in tooltip
			statusBarItem.backgroundColor = undefined;
		} else if (slopScore >= errorThreshold) {
			statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
		} else if (slopScore >= warnThreshold) {
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
			? 'Slop Score: gathering data... (3 recs minimum)'
			: `Slop Score: ${slopScore.toFixed(1)}  ${slopScoreLabel(slopScore, warnThreshold, errorThreshold)}`;

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
}

// This method is called when your extension is deactivated
export function deactivate() { }

async function callApi<T>(
	context: vscode.ExtensionContext,
	path: string,
	options?: RequestInit
): Promise<T> {
	const apiKey = await context.secrets.get('aiCostOptimizer.apiKey');
	if (!apiKey) {
		vscode.window.showErrorMessage('API Key missing. Please run "AI Cost: Configure API Key" first.');
		throw new Error('API Key missing');
	}

	const url = `http://localhost:8000${path.startsWith('/') ? path : `/${path}`}`;

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

	// Rule 3: Fast code task — code signal but user wants speed
	if ((features.hasCode || features.intent === 'debug') && features.latencySensitive) {
		return {
			model: pickFromCategory('FAST', enabledModels),
			reason: 'Quick code or debug task',
			confidence: 'medium',
			category: 'FAST',
		};
	}

	// Rule 4: Standard code/debug — no speed constraint
	if (features.hasCode || features.intent === 'debug') {
		return {
			model: pickFromCategory('CODE', enabledModels),
			reason: 'Code or debugging task',
			confidence: 'medium',
			category: 'CODE',
		};
	}

	// Rule 5: Explain intent — route by complexity
	if (features.intent === 'explain') {
		const category = features.reasoningLevel === 'high' ? 'HIGH_REASONING' : 'GENERAL';
		return {
			model: pickFromCategory(category, enabledModels),
			reason: 'Explanation task',
			confidence: 'medium',
			category,
		};
	}

	// Rule 6: Summarize or short latency-sensitive → fast
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
		reason: 'No strong signal detected — try being more explicit',
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