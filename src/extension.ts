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
};

// ── Module-level state ─────────────────────────────────────

let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

function getTodayDate(): string {
	return new Date().toISOString().split('T')[0];
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "slopcost" is now active!');

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

		try {
			const rows = await callApi<DailyCost[]>(context, '/analytics/daily-cost');
			const today = getTodayDate();
			const todayRow = rows.find(r => r.date === today);

			outputChannel.clear();
			outputChannel.appendLine('=== AI Cost: Today\'s Summary ===');
			outputChannel.appendLine('');

			if (todayRow) {
				outputChannel.appendLine(`Date:        ${todayRow.date}`);
				outputChannel.appendLine(`Environment: ${todayRow.environment}`);
				outputChannel.appendLine(`Total Cost:  $${todayRow.total_cost_usd}`);
				outputChannel.appendLine(`Tokens Used: ${todayRow.total_tokens.toLocaleString()}`);
				outputChannel.appendLine(`Requests:    ${todayRow.request_count.toLocaleString()}`);
			} else {
				outputChannel.appendLine(`No cost data recorded for ${today} yet.`);
				if (rows.length > 0) {
					const latest = rows[rows.length - 1];
					outputChannel.appendLine('');
					outputChannel.appendLine(`Latest available: ${latest.date}  —  $${latest.total_cost_usd}`);
				}
			}

			outputChannel.appendLine('');
			outputChannel.appendLine('================================');
			outputChannel.show(true);
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

			outputChannel.clear();
			outputChannel.appendLine('=== AI Cost: Explanation ===');
			outputChannel.appendLine('');
			outputChannel.appendLine(`Date:        ${data.date}`);
			outputChannel.appendLine(`Environment: ${data.environment}`);
			outputChannel.appendLine('');
			outputChannel.appendLine('Summary:');
			outputChannel.appendLine(`  ${data.summary}`);
			outputChannel.appendLine('');
			outputChannel.appendLine('Key Drivers:');
			data.key_drivers.forEach((driver, i) => {
				outputChannel.appendLine(`  ${i + 1}. ${driver}`);
			});
			outputChannel.appendLine('');
			outputChannel.appendLine('Recommendations:');
			data.recommendations.forEach((rec, i) => {
				outputChannel.appendLine(`  ${i + 1}. ${rec}`);
			});
			outputChannel.appendLine('');
			outputChannel.appendLine('============================');
			outputChannel.show(true);
		} catch {
			// callApi already shows user-facing errors
		}
	});

	context.subscriptions.push(disposable, showTodayCostCmd, explainTodayCostCmd);

	// ── Status Bar: Model Recommendation ──────────────────

	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItem.text = '$(lightbulb) AI Model: gpt-4o-mini (General-purpose)';
	statusBarItem.tooltip = 'Recommended model: gpt-4o-mini\nReason: General-purpose default\nConfidence: low';
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);

	// ── Debounced Editor Listener ─────────────────────────

	function updateRecommendation() {
		const editor = vscode.window.activeTextEditor;
		if (!editor) { return; }

		const text = editor.document.getText();
		const features = extractPromptFeatures(text);
		const rec = recommendModel(features);

		// Keep status bar text short; tooltip has full detail
		const shortReason = rec.reason.length > 30
			? rec.reason.substring(0, 27) + '...'
			: rec.reason;

		statusBarItem.text = `$(lightbulb) AI Model: ${rec.model} (${shortReason})`;
		statusBarItem.tooltip = [
			`Recommended model: ${rec.model}`,
			`Reason: ${rec.reason}`,
			`Confidence: ${rec.confidence}`,
		].join('\n');
	}

	function scheduleUpdate() {
		if (debounceTimer) { clearTimeout(debounceTimer); }
		// 400ms debounce prevents excessive computation while typing
		debounceTimer = setTimeout(updateRecommendation, 400);
	}

	// Fire on keystroke (selection changes on every edit)
	context.subscriptions.push(
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

function recommendModel(features: PromptFeatures): ModelRecommendation {
	// Rule 1: Complex reasoning demands the most capable model
	if (features.reasoningLevel === 'high') {
		return {
			model: 'gpt-4',
			reason: 'High reasoning depth detected',
			confidence: 'high',
		};
	}

	// Rule 2: Code-related tasks benefit from code-optimized models
	if (features.hasCode || features.intent === 'debug') {
		return {
			model: 'gpt-4o-mini',
			reason: 'Code-related or debugging task',
			confidence: 'medium',
		};
	}

	// Rule 3: Short, latency-sensitive prompts → fastest model
	if (features.latencySensitive && features.estimatedTokens < 300) {
		return {
			model: 'gemini-1.5-flash',
			reason: 'Short prompt with low latency requirement',
			confidence: 'high',
		};
	}

	// Rule 4: Summarization is well-suited for fast models
	if (features.intent === 'summarize') {
		return {
			model: 'gemini-1.5-flash',
			reason: 'Summarization task',
			confidence: 'medium',
		};
	}

	// Fallback: general-purpose default
	return {
		model: 'gpt-4o-mini',
		reason: 'General-purpose default',
		confidence: 'low',
	};
}
