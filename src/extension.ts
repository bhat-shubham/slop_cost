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

let outputChannel: vscode.OutputChannel;

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
