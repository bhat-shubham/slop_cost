# SlopCost

A local-first VS Code extension that tracks AI development cost, token usage, and provides a real-time 'Slop Score' based on inference efficiency.

## Overview

SlopCost acts as a local proxy between your IDE (Cursor, VS Code + Continue) and your model providers.
It records usage data without ever sending prompt text, response content, or API keys to the backend.

- **Real-time Recommender**: Suggests the most cost-efficient model based on your typing patterns.
- **Slop Score**: A visual score metric reflecting how efficiently you use AI bandwidth.
- **Cost Tracking**: Logs cost by day, by model, and by endpoint.
- **Session Stats**: Live summary of tokens used in the current programming session.
- **Privacy First**: Fully self-hostable, with an explicit opt-in telemetry gate.

## Privacy

SlopCost is a local-first tool. Here is exactly what it does and does not collect.

### What the extension collects

| Data | Collected | Destination |
|---|---|---|
| Prompt text | **Never** | — |
| Response text | **Never** | — |
| Your API keys | **Never** | — |
| File contents | **Never** | — |
| File paths | **Never** | — |
| Model name | Yes | Your self-hosted backend |
| Input token count | Yes | Your self-hosted backend |
| Output token count | Yes | Your self-hosted backend |
| Estimated cost (USD) | Yes | Your self-hosted backend |
| Intent classification | Yes | Your self-hosted backend |
| Workspace ID (hashed) | Yes | Your self-hosted backend |
| Timestamp | Yes | Your self-hosted backend |

### Key guarantees

- **Opt-in only.** Usage ingest is disabled by default. You must explicitly enable it in settings or respond to the one-time prompt.
- **Local proxy binds to 127.0.0.1 only.** The proxy is unreachable from any other machine on your network.
- **Your backend, your data.** SlopCost sends data to your self-hosted backend at `slopcost.backendUrl` (default: `http://localhost:8000`). Anthropic, OpenAI, and the SlopCost authors never receive your usage data.
- **Workspace ID is a one-way hash.** The raw workspace path is never sent. A djb2 hash is used for anonymous grouping. You can override it with a human-readable alias via `slopcost.workspaceAlias` or in `.slopcost`.
- **API keys stored in VS Code Secret Storage.** Never in `settings.json`, never logged, never sent anywhere other than your configured backend.

### For org deployments

Commit a `.slopcost` file to your repository to standardise budget limits, environment tags, and workspace aliases across the team:

```json
{
  "dailyBudgetUsd":    5.00,
  "weeklyBudgetUsd":   20.00,
  "alertThresholdPct": 80,
  "environment":       "dev",
  "workspaceAlias":    "your-team-name"
}
```

Enable ingest for the team by setting `slopcost.enableUsageIngest: true` in a committed `.vscode/settings.json`:

```json
{
  "slopcost.enableUsageIngest": true,
  "slopcost.backendUrl": "http://your-internal-backend:8000"
}
```
