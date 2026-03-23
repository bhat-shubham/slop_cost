import * as vscode from 'vscode';

export function getDashboardHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  const cspSource = webview.cspSource;

  const csp = "default-src 'none'; " +
    "style-src " + cspSource + " 'unsafe-inline'; " +
    "script-src 'unsafe-inline'; " +
    "img-src " + cspSource + " data:;";

  const html = '<!DOCTYPE html>\n' +
    '<html lang="en">\n' +
    '<head>\n' +
    '  <meta charset="UTF-8"/>\n' +
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>\n' +
    '  <meta http-equiv="Content-Security-Policy" content="' + csp + '"/>\n' +
    '  <title>SlopCost</title>\n' +
    '  <style>\n' +
    '    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }\n' +
    '\n' +
    '    body {\n' +
    '      font-family: var(--vscode-font-family);\n' +
    '      font-size:   var(--vscode-font-size);\n' +
    '      color:       var(--vscode-foreground);\n' +
    '      background:  var(--vscode-sideBar-background);\n' +
    '      padding:     0 0 24px 0;\n' +
    '      overflow-x:  hidden;\n' +
    '    }\n' +
    '\n' +
    '    .header {\n' +
    '      padding: 14px 16px 10px;\n' +
    '      border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));\n' +
    '      display: flex;\n' +
    '      align-items: center;\n' +
    '      justify-content: space-between;\n' +
    '    }\n' +
    '\n' +
    '    .brand { display: flex; align-items: center; gap: 8px; }\n' +
    '\n' +
    '    .brand-mark {\n' +
    '      font-family: monospace;\n' +
    '      font-size: 11px;\n' +
    '      line-height: 1.3;\n' +
    '      color: var(--vscode-charts-yellow, #e8c07a);\n' +
    '      white-space: pre;\n' +
    '    }\n' +
    '\n' +
    '    .brand-name {\n' +
    '      font-size: 11px; font-weight: 600;\n' +
    '      letter-spacing: 0.08em; text-transform: uppercase;\n' +
    '      color: var(--vscode-sideBarTitle-foreground, var(--vscode-foreground));\n' +
    '    }\n' +
    '\n' +
    '    .brand-version { font-size: 10px; color: var(--vscode-descriptionForeground); margin-top: 1px; }\n' +
    '\n' +
    '    .score-pill {\n' +
    '      font-size: 10px; font-weight: 600;\n' +
    '      padding: 3px 8px; border-radius: 10px;\n' +
    '      border: 1px solid currentColor;\n' +
    '      letter-spacing: 0.05em; transition: all 0.3s ease;\n' +
    '    }\n' +
    '    .score-ok     { color: var(--vscode-charts-green,  #4caf50); }\n' +
    '    .score-warn   { color: var(--vscode-charts-yellow, #e8c07a); }\n' +
    '    .score-danger { color: var(--vscode-charts-red,    #f44336); }\n' +
    '\n' +
    '    .section { padding: 12px 16px 0; }\n' +
    '\n' +
    '    .section-title {\n' +
    '      font-size: 10px; font-weight: 600;\n' +
    '      letter-spacing: 0.12em; text-transform: uppercase;\n' +
    '      color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-descriptionForeground));\n' +
    '      margin-bottom: 8px; padding-bottom: 4px;\n' +
    '      border-bottom: 1px solid var(--vscode-panel-border);\n' +
    '    }\n' +
    '\n' +
    '    .today-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin-bottom: 4px; }\n' +
    '\n' +
    '    .stat-card {\n' +
    '      background: var(--vscode-input-background);\n' +
    '      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));\n' +
    '      border-radius: 4px; padding: 8px 10px; text-align: center;\n' +
    '    }\n' +
    '\n' +
    '    .stat-value {\n' +
    '      font-size: 16px; font-weight: 700; font-family: monospace;\n' +
    '      color: var(--vscode-charts-yellow, #e8c07a); line-height: 1.2;\n' +
    '    }\n' +
    '    .stat-value.dim { color: var(--vscode-foreground); font-size: 13px; }\n' +
    '\n' +
    '    .stat-label {\n' +
    '      font-size: 9px; color: var(--vscode-descriptionForeground);\n' +
    '      margin-top: 3px; letter-spacing: 0.06em; text-transform: uppercase;\n' +
    '    }\n' +
    '\n' +
    '    .sparkline-wrap {\n' +
    '      background: var(--vscode-input-background);\n' +
    '      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));\n' +
    '      border-radius: 4px; padding: 10px; position: relative;\n' +
    '    }\n' +
    '    .sparkline-wrap svg { width: 100%; height: 48px; overflow: visible; }\n' +
    '\n' +
    '    .spark-label {\n' +
    '      font-size: 9px; color: var(--vscode-descriptionForeground);\n' +
    '      margin-top: 6px; display: flex; justify-content: space-between;\n' +
    '    }\n' +
    '\n' +
    '    .bar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; font-size: 11px; }\n' +
    '\n' +
    '    .bar-model {\n' +
    '      width: 90px; flex-shrink: 0; overflow: hidden;\n' +
    '      text-overflow: ellipsis; white-space: nowrap;\n' +
    '      color: var(--vscode-foreground); font-family: monospace; font-size: 10px;\n' +
    '    }\n' +
    '\n' +
    '    .bar-track { flex: 1; height: 6px; background: var(--vscode-input-background); border-radius: 3px; overflow: hidden; }\n' +
    '\n' +
    '    .bar-fill {\n' +
    '      height: 100%; border-radius: 3px;\n' +
    '      background: var(--vscode-charts-yellow, #e8c07a);\n' +
    '      transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);\n' +
    '    }\n' +
    '    .bar-fill.high { background: var(--vscode-charts-red,    #f44336); }\n' +
    '    .bar-fill.mid  { background: var(--vscode-charts-yellow, #e8c07a); }\n' +
    '    .bar-fill.low  { background: var(--vscode-charts-green,  #4caf50); }\n' +
    '\n' +
    '    .bar-cost {\n' +
    '      width: 52px; text-align: right; font-size: 10px;\n' +
    '      font-family: monospace; color: var(--vscode-descriptionForeground); flex-shrink: 0;\n' +
    '    }\n' +
    '\n' +
    '    .feed { max-height: 180px; overflow-y: auto; scrollbar-width: thin; }\n' +
    '\n' +
    '    .feed-item {\n' +
    '      display: flex; align-items: center; gap: 6px;\n' +
    '      padding: 4px 0; border-bottom: 1px solid var(--vscode-panel-border);\n' +
    '      font-size: 11px; animation: fadeIn 0.2s ease;\n' +
    '    }\n' +
    '    .feed-item:last-child { border-bottom: none; }\n' +
    '\n' +
    '    @keyframes fadeIn {\n' +
    '      from { opacity: 0; transform: translateY(-4px); }\n' +
    '      to   { opacity: 1; transform: translateY(0); }\n' +
    '    }\n' +
    '\n' +
    '    .feed-category {\n' +
    '      font-size: 9px; font-weight: 600; padding: 2px 5px;\n' +
    '      border-radius: 3px; letter-spacing: 0.05em; flex-shrink: 0;\n' +
    '    }\n' +
    '\n' +
    '    .cat-HIGH_REASONING { background: rgba(244,67,54,0.15);  color: var(--vscode-charts-red,    #f44336); }\n' +
    '    .cat-CODE           { background: rgba(33,150,243,0.15); color: var(--vscode-charts-blue,   #42a5f5); }\n' +
    '    .cat-FAST           { background: rgba(76,175,80,0.15);  color: var(--vscode-charts-green,  #4caf50); }\n' +
    '    .cat-GENERAL        { background: rgba(232,192,122,0.15);color: var(--vscode-charts-yellow, #e8c07a); }\n' +
    '\n' +
    '    .feed-model {\n' +
    '      font-family: monospace; font-size: 10px; color: var(--vscode-foreground);\n' +
    '      flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;\n' +
    '    }\n' +
    '\n' +
    '    .feed-intent { font-size: 9px; color: var(--vscode-descriptionForeground); flex-shrink: 0; }\n' +
    '\n' +
    '    .feed-empty {\n' +
    '      font-size: 11px; color: var(--vscode-descriptionForeground);\n' +
    '      padding: 12px 0; text-align: center;\n' +
    '    }\n' +
    '\n' +
    '    .actions { display: flex; flex-wrap: wrap; gap: 6px; padding: 12px 16px 0; }\n' +
    '\n' +
    '    .btn {\n' +
    '      font-family: var(--vscode-font-family); font-size: 11px;\n' +
    '      padding: 5px 10px; border-radius: 3px;\n' +
    '      border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));\n' +
    '      background: var(--vscode-button-secondaryBackground, var(--vscode-input-background));\n' +
    '      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));\n' +
    '      cursor: pointer; transition: background 0.15s, border-color 0.15s; white-space: nowrap;\n' +
    '    }\n' +
    '    .btn:hover {\n' +
    '      background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground));\n' +
    '      border-color: var(--vscode-focusBorder);\n' +
    '    }\n' +
    '    .btn.primary {\n' +
    '      background: var(--vscode-button-background); color: var(--vscode-button-foreground);\n' +
    '      border-color: var(--vscode-button-background);\n' +
    '    }\n' +
    '    .btn.primary:hover { background: var(--vscode-button-hoverBackground); }\n' +
    '\n' +
    '    .loading {\n' +
    '      padding: 24px 16px; text-align: center;\n' +
    '      color: var(--vscode-descriptionForeground); font-size: 11px;\n' +
    '    }\n' +
    '\n' +
    '    .error-state {\n' +
    '      padding: 16px; font-size: 11px;\n' +
    '      color: var(--vscode-charts-red, #f44336); background: rgba(244,67,54,0.08);\n' +
    '      border-radius: 4px; margin: 12px 16px 0;\n' +
    '    }\n' +
    '\n' +
    '    .divider { height: 1px; background: var(--vscode-panel-border); margin: 12px 16px 0; }\n' +
    '\n' +
    '    .no-key { padding: 24px 16px; text-align: center; }\n' +
    '    .no-key p { font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 10px; }\n' +
    '  </style>\n' +
    '</head>\n' +
    '<body>\n' +
    '\n' +
    '  <div class="header">\n' +
    '    <div class="brand">\n' +
    '      <div class="brand-mark">\u23a1 | \u23a4\n' +
    '\u23a2>$ \u25ae\u23a5\n' +
    '\u23a3 | \u23a6</div>\n' +
    '      <div>\n' +
    '        <div class="brand-name">SlopCost</div>\n' +
    '        <div class="brand-version">v0.0.1</div>\n' +
    '      </div>\n' +
    '    </div>\n' +
'    <div>\n' +
'      <div id="score-pill" class="score-pill score-ok" style="display:inline-block">\u2014</div>\n' +
'      <span id="ingest-badge" style="\n' +
'        font-size:9px;\n' +
'        color:var(--vscode-descriptionForeground);\n' +
'        display:none;\n' +
'        margin-left:4px;\n' +
'      ">ingest off</span>\n' +
'    </div>\n' +
'  </div>\n' +
    '\n' +
    '  <div id="root"><div class="loading">Loading...</div></div>\n' +
    '\n' +
    '  <div class="actions" id="actions" style="display:none">\n' +
    '    <button class="btn primary" onclick="cmd(\'aiCost.checkBudget\')">Check Budget</button>\n' +
    '    <button class="btn" onclick="cmd(\'aiCost.explainTodayCost\')">Explain Cost</button>\n' +
    '    <button class="btn" onclick="cmd(\'aiCost.showSessionStats\')">Session Stats</button>\n' +
    '    <button class="btn" onclick="cmd(\'aiCost.showByModel\')">By Model</button>\n' +
    '  </div>\n' +
    '\n' +
    '  <script>\n' +
    '    var vscApi = acquireVsCodeApi();\n' +
    '\n' +
    '    function cmd(command) { vscApi.postMessage({ type: "command", command: command }); }\n' +
    '    function requestData() { vscApi.postMessage({ type: "requestData" }); }\n' +
    '\n' +
    '    function renderSparkline(costs) {\n' +
    '      if (!costs || costs.length === 0) {\n' +
    '        return \'<div class="sparkline-wrap"><div style="text-align:center;font-size:10px;padding:16px;color:var(--vscode-descriptionForeground)">no data yet</div></div>\';\n' +
    '      }\n' +
    '      var W = 260, H = 48, PAD = 4;\n' +
    '      var vals = costs.map(function(d) { return parseFloat(d.total_cost_usd) || 0; });\n' +
    '      var max = Math.max.apply(null, vals.concat([0.0001]));\n' +
    '      var min = Math.min.apply(null, vals);\n' +
    '      var range = max - min || 0.0001;\n' +
    '      var pts = vals.map(function(v, i) {\n' +
    '        var x = PAD + (i / Math.max(vals.length - 1, 1)) * (W - PAD * 2);\n' +
    '        var y = H - PAD - ((v - min) / range) * (H - PAD * 2);\n' +
    '        return x.toFixed(1) + "," + y.toFixed(1);\n' +
    '      }).join(" ");\n' +
    '      if (vals.length === 1) {\n' +
    '        var sy = (H - PAD - ((vals[0] - min) / range) * (H - PAD * 2)).toFixed(1);\n' +
    '        pts = PAD + "," + sy + " " + (W - PAD) + "," + sy;\n' +
    '      }\n' +
    '      var labels = costs.length >= 2\n' +
    '        ? \'<div class="spark-label"><span>\' + costs[0].date.slice(5) + "</span><span>" + costs[costs.length-1].date.slice(5) + "</span></div>"\n' +
    '        : "";\n' +
    '      return \'<div class="sparkline-wrap">\' +\n' +
    '        \'<svg viewBox="0 0 \' + W + " " + H + \'" preserveAspectRatio="none">\' +\n' +
    '          \'<defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">\' +\n' +
    '            \'<stop offset="0%" stop-color="var(--vscode-charts-yellow,#e8c07a)" stop-opacity="0.25"/>\' +\n' +
    '            \'<stop offset="100%" stop-color="var(--vscode-charts-yellow,#e8c07a)" stop-opacity="0.02"/>\' +\n' +
    '          "</linearGradient></defs>" +\n' +
    '          \'<polyline points="\' + pts + \'" fill="none" stroke="var(--vscode-charts-yellow,#e8c07a)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>\' +\n' +
    '        "</svg>" + labels + "</div>";\n' +
    '    }\n' +
    '\n' +
    '    function renderBars(models) {\n' +
    '      if (!models || models.length === 0) {\n' +
    '        return \'<div style="font-size:11px;color:var(--vscode-descriptionForeground);padding:8px 0">no model data yet</div>\';\n' +
    '      }\n' +
    '      var sorted = models.slice().sort(function(a, b) {\n' +
    '        return parseFloat(b.total_cost_usd) - parseFloat(a.total_cost_usd);\n' +
    '      }).slice(0, 5);\n' +
    '      var maxCost = parseFloat(sorted[0].total_cost_usd) || 0.0001;\n' +
    '      return sorted.map(function(m, i) {\n' +
    '        var cost = parseFloat(m.total_cost_usd);\n' +
    '        var pct  = Math.max((cost / maxCost) * 100, 2).toFixed(1);\n' +
    '        var cls  = i === 0 ? "high" : i <= 1 ? "mid" : "low";\n' +
    '        var name = m.model_name || m.model;\n' +
    '        var shortName = name.length > 18 ? name.slice(0, 16) + ".." : name;\n' +
    '        return \'<div class="bar-row">\' +\n' +
    '          \'<div class="bar-model" title="\' + name + \'">\' + shortName + "</div>" +\n' +
    '          \'<div class="bar-track"><div class="bar-fill \' + cls + \'" style="width:\' + pct + \'%"></div></div>\' +\n' +
    '          \'<div class="bar-cost">$\' + cost.toFixed(4) + "</div></div>";\n' +
    '      }).join("");\n' +
    '    }\n' +
    '\n' +
    '    function renderFeed(items) {\n' +
    '      if (!items || items.length === 0) {\n' +
    '        return \'<div class="feed-empty">start typing to see recommendations</div>\';\n' +
    '      }\n' +
    '      return items.slice(0, 12).map(function(item) {\n' +
    '        return \'<div class="feed-item">\' +\n' +
    '          \'<span class="feed-category cat-\' + item.category + \'">\' + item.category.replace("_", " ") + "</span>" +\n' +
    '          \'<span class="feed-model">\' + item.model + "</span>" +\n' +
    '          \'<span class="feed-intent">\' + item.intent + "</span></div>";\n' +
    '      }).join("");\n' +
    '    }\n' +
    '\n' +
    '    function render(state) {\n' +
    '      var root    = document.getElementById("root");\n' +
    '      var actions = document.getElementById("actions");\n' +
    '      var pill    = document.getElementById("score-pill");\n' +
    '      if (state.slopScore !== null && state.slopScore !== undefined) {\n' +
    '        var s = parseFloat(state.slopScore);\n' +
    '        pill.textContent = "slop " + s.toFixed(1);\n' +
    '        pill.className = "score-pill " + (s >= 10 ? "score-danger" : s >= 5 ? "score-warn" : "score-ok");\n' +
    '      } else {\n' +
    '        pill.textContent = "\\u2014";\n' +
    '        pill.className = "score-pill score-ok";\n' +
    '      }\n' +
    '      var ingestBadge = document.getElementById("ingest-badge");\n' +
    '      if (ingestBadge) {\n' +
    '        ingestBadge.textContent  = state.ingestEnabled ? "" : "ingest off";\n' +
    '        ingestBadge.style.display = state.ingestEnabled ? "none" : "inline";\n' +
    '      }\n' +
    '      if (!state.hasApiKey) {\n' +
    '        actions.style.display = "none";\n' +
    '        root.innerHTML = \'<div class="no-key"><p>Configure your API key to see analytics.</p>\' +\n' +
    '          \'<button class="btn primary" onclick="cmd(\\\'aiCost.configureApiKey\\\')">Configure API Key</button></div>\';\n' +
    '        return;\n' +
    '      }\n' +
    '      actions.style.display = "flex";\n' +
    '      if (state.error) {\n' +
    '        root.innerHTML = \'<div class="error-state">\\u26a0 \' + state.error + "</div>";\n' +
    '        return;\n' +
    '      }\n' +
    '      if (state.loading) {\n' +
    '        root.innerHTML = \'<div class="loading">Loading...</div>\';\n' +
    '        return;\n' +
    '      }\n' +
    '      var today = state.todayData;\n' +
    '      var costStr  = today ? parseFloat(today.total_cost_usd).toFixed(4) : "0.0000";\n' +
    '      var tokenStr = today ? parseInt(today.total_tokens).toLocaleString() : "0";\n' +
    '      var reqStr   = today ? today.request_count : "0";\n' +
    '      root.innerHTML =\n' +
    '        \'<div class="section"><div class="section-title">Today</div><div class="today-grid">\' +\n' +
    '          \'<div class="stat-card"><div class="stat-value">$\' + costStr + \'</div><div class="stat-label">cost</div></div>\' +\n' +
    '          \'<div class="stat-card"><div class="stat-value dim">\' + tokenStr + \'</div><div class="stat-label">tokens</div></div>\' +\n' +
    '          \'<div class="stat-card"><div class="stat-value dim">\' + reqStr + \'</div><div class="stat-label">requests</div></div>\' +\n' +
    '        "</div></div>" +\n' +
    '        \'<div class="divider"></div>\' +\n' +
    '        \'<div class="section"><div class="section-title">7-day trend</div>\' + renderSparkline(state.weekData) + "</div>" +\n' +
    '        \'<div class="divider"></div>\' +\n' +
    '        \'<div class="section"><div class="section-title">by model</div>\' + renderBars(state.modelData) + "</div>" +\n' +
    '        \'<div class="divider"></div>\' +\n' +
    '        \'<div class="section"><div class="section-title">live recommendations</div><div class="feed">\' + renderFeed(state.feedItems) + "</div></div>";\n' +
    '    }\n' +
    '\n' +
    '    window.addEventListener("message", function(event) {\n' +
    '      var msg = event.data;\n' +
    '      if (msg.type === "update") { render(msg.state); }\n' +
    '    });\n' +
    '\n' +
    '    requestData();\n' +
    '  </script>\n' +
    '</body>\n' +
    '</html>';

  return html;
}
