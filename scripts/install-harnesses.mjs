#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const SERVER_NAME = "roblox-executor-mcp";
const CURRENT_REPO_DIR = process.cwd();
const DEFAULT_BRIDGE_URL = "localhost:16384";
const SERVER_PORT = 16384;

const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  purple: "\x1b[35m",
  gray: "\x1b[90m",
  inverse: "\x1b[7m",
};

const ALL_HARNESSES = [
  { id: "codex", name: "Codex", group: "Recommended", config: { kind: "codexToml", path: homePath(".codex", "config.toml") } },
  { id: "claude-code", name: "Claude Code", group: "Recommended", config: { kind: "claudeCli" } },
  { id: "opencode", name: "OpenCode", group: "Recommended", config: { kind: "opencodeJson", path: homePath(".config", "opencode", "opencode.json") } },
  { id: "cursor", name: "Cursor", group: "Recommended", config: { kind: "mcpServersJson", path: homePath(".cursor", "mcp.json") } },
  { id: "antigravity", name: "Antigravity", group: "Recommended", config: { kind: "mcpServersJson", path: homePath(".gemini", "antigravity", "mcp_config.json") } },
  { id: "gemini-cli", name: "Gemini CLI", group: "Recommended", config: { kind: "mcpServersJson", path: homePath(".gemini", "settings.json"), extra: { trust: true } } },
  { id: "github-copilot", name: "GitHub Copilot", group: "Recommended", config: { kind: "mcpServersJson", path: homePath(".copilot", "mcp-config.json") } },
  { id: "vscode-copilot", name: "VS Code Copilot", group: "Recommended", config: { kind: "vscodeCli" } },
  { id: "amp", name: "Amp", group: "Others", config: { kind: "ampJson", path: vscodeSettingsPath(), experimental: true } },
  { id: "cline", name: "Cline", group: "Others", config: { kind: "mcpServersJson", path: homePath(".cline", "data", "settings", "cline_mcp_settings.json") } },
  { id: "claude-desktop", name: "Claude Desktop", group: "Others", config: { kind: "mcpServersJson", path: claudeDesktopConfigPath() } },
  { id: "deep-agents", name: "Deep Agents", group: "Others", config: { kind: "mcpServersJson", path: homePath(".deepagents", ".mcp.json"), experimental: true } },
  { id: "kimi-cli", name: "Kimi CLI", group: "Others", config: { kind: "mcpServersJson", path: homePath(".kimi", "mcp.json"), experimental: true } },
  { id: "augment", name: "Augment", group: "Others", config: { kind: "mcpServersJson", path: homePath(".augment", "settings.json"), experimental: true } },
  { id: "continue", name: "Continue", group: "Others", config: { kind: "continueYaml", path: homePath(".continue", "config.yaml") } },
  { id: "devin-terminal", name: "Devin for Terminal", group: "Others", config: { kind: "mcpServersJson", path: homePath(".config", "devin", "config.json"), experimental: true } },
  { id: "goose", name: "Goose", group: "Others", config: { kind: "gooseYaml", path: gooseConfigPath(), experimental: true } },
  { id: "iflow-cli", name: "iFlow CLI", group: "Others", config: { kind: "mcpServersJson", path: homePath(".iflow", "settings.json"), experimental: true } },
  { id: "kilo-code", name: "Kilo Code", group: "Others", config: { kind: "kiloJson", path: homePath(".config", "kilo", "kilo.json"), experimental: true } },
  { id: "kiro-cli", name: "Kiro CLI", group: "Others", config: { kind: "mcpServersJson", path: homePath(".kiro", "settings", "mcp.json"), experimental: true } },
  { id: "mistral-vibe", name: "Mistral Vibe", group: "Others", config: { kind: "vibeToml", path: homePath(".vibe", "config.toml"), experimental: true } },
  { id: "openhands", name: "OpenHands", group: "Others", config: { kind: "mcpServersJson", path: homePath(".openhands", "mcp.json"), experimental: true } },
  { id: "qwen-code", name: "Qwen Code", group: "Others", config: { kind: "mcpServersJson", path: homePath(".qwen", "settings.json"), extra: { trust: true }, experimental: true } },
  { id: "rovo-dev", name: "Rovo Dev", group: "Others", config: { kind: "mcpServersJson", path: homePath(".rovodev", "mcp_config.json"), experimental: true } },
  { id: "roo-code", name: "Roo Code", group: "Others", config: { kind: "mcpServersJson", path: vscodeGlobalStoragePath("rooveterinaryinc.roo-cline", "settings", "mcp_settings.json"), experimental: true } },
  { id: "tabnine-cli", name: "Tabnine CLI", group: "Others", config: { kind: "mcpServersJson", path: homePath(".tabnine", "mcp_servers.json"), experimental: true } },
  { id: "windsurf", name: "Windsurf", group: "Others", config: { kind: "mcpServersJson", path: homePath(".codeium", "windsurf", "mcp_config.json") } },
  { id: "manual", name: "Manual", group: "Others", config: { kind: "manualRecipe" } },
];

const NON_INTERACTIVE = process.argv.includes("--yes") || process.argv.includes("-y");
const DRY_RUN = process.argv.includes("--dry-run");
const UPDATE_MODE = process.argv.includes("--update");

main().catch((error) => {
  console.error(`\n${colors.red}error:${colors.reset} ${error.message || error}`);
  process.exitCode = 1;
});

async function main() {
  if (UPDATE_MODE) {
    await runUpdateMode();
    return;
  }

  const initial = new Set();
  const selected = NON_INTERACTIVE ? initial : await selectHarnesses(initial);
  if (!NON_INTERACTIVE) {
    console.log(`${colors.green}Selected harnesses:${colors.reset} ${formatSelection(selected)}`);
  }
  const crossMachine = NON_INTERACTIVE
    ? null
    : await configureCrossMachineSetup();
  const shouldPull =
    !NON_INTERACTIVE && isGitRepository(CURRENT_REPO_DIR)
      ? await askYesNo("Pull latest changes before install/build", false)
      : false;
  const semanticSettings = await readSemanticSettingsStatus();
  if (!NON_INTERACTIVE && semanticSettings.exists) {
    console.log(`${colors.cyan}Semantic indexing:${colors.reset} existing ${semanticSettings.summary}`);
  }
  const shouldOllama =
    NON_INTERACTIVE || semanticSettings.exists
      ? false
      : await askYesNo("Optionally set up Ollama + embeddinggemma for semantic indexing", false);

  const serverRoot = path.resolve(CURRENT_REPO_DIR);
  const serverEntry = path.join(serverRoot, "dist", "index.js");
  const results = [];

  section("Install");
  if (shouldPull) {
    await pullLatest(serverRoot, results);
  }
  await installServer(serverRoot, results);

  if (crossMachine) {
    section("Network Setup");
    if (crossMachine.firewallStatus) {
      log(crossMachine.firewallStatus.status, crossMachine.firewallStatus.message);
    }
  }

  if (shouldOllama) {
    section("Ollama");
    await setupOllama(results);
  }

  section("Provider Configs");
  const selectedHarnesses = ALL_HARNESSES.filter((h) => selected.has(h.id));
  if (!selectedHarnesses.length) {
    log("skip", "No harnesses selected.");
  }
  for (const harness of selectedHarnesses) {
    await configureHarness(harness, serverEntry, results);
  }

  section("Summary");
  for (const item of results) {
    log(item.status, item.message);
  }

  if (selected.has("manual")) {
    console.log(`\n${colors.yellow}Manual MCP recipe:${colors.reset}`);
    console.log(JSON.stringify({ mcpServers: { [SERVER_NAME]: mcpServerConfig(serverEntry) } }, null, 2));
  }

  console.log(`\n${colors.green}Done.${colors.reset} Restart selected clients, then connect Roblox with:`);
  const loaderSnippet = buildLoaderSnippet(crossMachine?.bridgeUrl);
  console.log(`${colors.cyan}${loaderSnippet}${colors.reset}`);
  if (crossMachine) {
    const copied = await copyToClipboard(loaderSnippet).catch((error) => {
      log("warn", `Could not copy Roblox loader to clipboard: ${error.message || error}`);
      return false;
    });
    if (copied) log("ok", "Roblox loader copied to clipboard");
  }
  showCursor();
}

async function runUpdateMode() {
  const serverRoot = path.resolve(CURRENT_REPO_DIR);
  const results = [];

  section("Update");
  log("info", `Using current repository: ${serverRoot}`);

  const processes = findMcpServerProcesses(serverRoot);
  if (processes.length) {
    console.log(`${colors.yellow}Found ${processes.length} running MCP server process(es):${colors.reset}`);
    for (const proc of processes) {
      console.log(`${colors.gray}${String(proc.pid).padStart(6)}${colors.reset} ${proc.command}`);
    }
    const shouldKill =
      !NON_INTERACTIVE && (await askYesNo("Kill running MCP server processes before updating", false));
    if (shouldKill) {
      killProcesses(processes, results);
    } else {
      results.push({
        status: "warn",
        message: "Running MCP server processes were left alive. Restart clients after updating so they use the new build.",
      });
    }
  } else {
    log("skip", "No running MCP server processes found.");
  }

  const shouldPull =
    !NON_INTERACTIVE && isGitRepository(serverRoot)
      ? await askYesNo("Pull latest changes before rebuild", false)
      : false;
  if (shouldPull) {
    await pullLatest(serverRoot, results);
  }

  await installServer(serverRoot, results, { announceRepo: false });

  section("Summary");
  for (const item of results) {
    log(item.status, item.message);
  }
  showCursor();
}

async function installServer(serverRoot, results, options = {}) {
  if (options.announceRepo !== false) {
    log("info", `Using current repository: ${serverRoot}`);
  }
  const runner = commandExists("pnpm") ? "pnpm" : "npm";
  await run(
    runner,
    runner === "pnpm" ? ["install", "--ignore-scripts"] : ["install", "--ignore-scripts"],
    { cwd: serverRoot, label: `Installing dependencies with ${runner}` }
  );
  await run(runner, runner === "pnpm" ? ["run", "build"] : ["run", "build"], { cwd: serverRoot, label: "Building server" });
  const serverEntry = path.join(serverRoot, "dist", "index.js");
  if (!exists(serverEntry)) {
    throw new Error(`Build completed, but ${serverEntry} was not created.`);
  }
  results.push({ status: "ok", message: `Server ready at ${serverRoot}` });
}

async function pullLatest(serverRoot, results) {
  await run("git", ["pull", "--ff-only"], { cwd: serverRoot, label: "Pulling latest changes" });
  results.push({ status: "ok", message: "Repository updated with latest changes" });
}

function findMcpServerProcesses(serverRoot) {
  const serverEntry = path.join(serverRoot, "dist", "index.js");
  const normalizedEntry = normalizeProcessPath(serverEntry);
  const normalizedRoot = normalizeProcessPath(serverRoot);

  if (process.platform === "win32") {
    const script = [
      "$ErrorActionPreference = 'SilentlyContinue';",
      "Get-CimInstance Win32_Process |",
      "Where-Object { $_.CommandLine -and ($_.CommandLine -like '*dist/index.js*' -or $_.CommandLine -like '*dist\\\\index.js*') } |",
      "ForEach-Object { [PSCustomObject]@{ ProcessId = $_.ProcessId; CommandLine = $_.CommandLine } } |",
      "ConvertTo-Json -Compress",
    ].join(" ");
    const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.status !== 0 || !result.stdout.trim()) return [];
    try {
      const parsed = JSON.parse(result.stdout);
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      return rows
        .map((row) => ({ pid: Number(row.ProcessId), command: String(row.CommandLine || "") }))
        .filter((row) => isMatchingMcpProcess(row, normalizedEntry, normalizedRoot));
    } catch {
      return [];
    }
  }

  const result = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
  if (result.status !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      return match ? { pid: Number(match[1]), command: match[2] } : null;
    })
    .filter(Boolean)
    .filter((row) => isMatchingMcpProcess(row, normalizedEntry, normalizedRoot));
}

function isMatchingMcpProcess(proc, normalizedEntry, normalizedRoot) {
  if (!proc || !Number.isInteger(proc.pid) || proc.pid === process.pid) return false;
  const command = normalizeProcessPath(proc.command);
  return (
    command.includes(normalizedEntry) ||
    (command.includes("dist/index.js") && command.includes(normalizedRoot))
  );
}

function normalizeProcessPath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function killProcesses(processes, results) {
  if (DRY_RUN) {
    log("dry", `Would kill ${processes.length} MCP server process(es)`);
    return;
  }

  for (const proc of processes) {
    try {
      process.kill(proc.pid, "SIGTERM");
      results.push({ status: "ok", message: `Killed MCP server process ${proc.pid}` });
    } catch (error) {
      results.push({
        status: "warn",
        message: `Could not kill MCP server process ${proc.pid}: ${error.message || error}`,
      });
    }
  }
}

async function setupOllama(results) {
  if (!commandExists("ollama")) {
    const installed = await tryInstallOllama();
    if (!installed) {
      results.push({
        status: "warn",
        message: "Ollama was not found and no supported package manager was available. Install Ollama, then run `ollama pull embeddinggemma`.",
      });
      return;
    }
  }

  await run("ollama", ["pull", "embeddinggemma"], { label: "Pulling embeddinggemma" });
  const settingsPath = homePath(".roblox-mcp", "semantic-search.json");
  await writeJson(settingsPath, {
    provider: "ollama",
    openaiApiKey: "",
    openaiBaseUrl: "https://api.openai.com/v1",
    openaiModel: "text-embedding-3-small",
    ollamaBaseUrl: "http://localhost:11434",
    ollamaModel: "embeddinggemma",
    saveEmbeddingsToDisk: true,
  });
  results.push({ status: "ok", message: `Semantic settings wrote Ollama + embeddinggemma to ${settingsPath}` });
}

async function configureCrossMachineSetup() {
  const shouldUseLan = await askYesNo("Set up for Roblox on another machine on this network", false);
  if (!shouldUseLan) return null;

  const detectedIp = getLocalLanIp();
  const fallbackIp = detectedIp || "127.0.0.1";
  const ip = await askInput("Local machine IP for Roblox to reach (press Enter to use detected LAN IP)", fallbackIp);
  const bridgeUrl = normalizeBridgeUrl(ip);

  let firewallStatus = null;
  const firewallPlan = getFirewallPlan();
  if (firewallPlan) {
    const shouldPatchFirewall = await askYesNo(
      `Allow inbound TCP ${SERVER_PORT} through the firewall`,
      false
    );
    if (shouldPatchFirewall) {
      try {
        await run(firewallPlan.command, firewallPlan.args, { label: firewallPlan.label });
        firewallStatus = { status: "ok", message: firewallPlan.success };
      } catch (error) {
        firewallStatus = { status: "warn", message: `Firewall setup failed: ${error.message || error}` };
      }
    } else {
      firewallStatus = {
        status: "warn",
        message: `Firewall not changed. Make sure inbound TCP ${SERVER_PORT} is allowed for cross-machine Roblox clients.`,
      };
    }
  } else {
    firewallStatus = {
      status: "warn",
      message: `No automatic firewall patch is available for this OS. Allow inbound TCP ${SERVER_PORT} manually if clients cannot connect.`,
    };
  }

  return { bridgeUrl, firewallStatus };
}

function getLocalLanIp() {
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const entries of Object.values(nets)) {
    for (const entry of entries || []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      candidates.push(entry.address);
    }
  }
  return candidates.find((ip) => /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) || candidates[0] || null;
}

function normalizeBridgeUrl(value) {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");
  if (!trimmed) return DEFAULT_BRIDGE_URL;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (!url.port) url.port = String(SERVER_PORT);
    return `${url.hostname}:${url.port}`;
  } catch {
    return DEFAULT_BRIDGE_URL;
  }
}

function buildLoaderSnippet(bridgeUrl = DEFAULT_BRIDGE_URL) {
  if (bridgeUrl === DEFAULT_BRIDGE_URL) {
    return `local bridgeUrl = getgenv().BridgeURL or "${DEFAULT_BRIDGE_URL}"\nloadstring(game:HttpGet("http://" .. bridgeUrl .. "/script.luau"))()`;
  }
  return `getgenv().BridgeURL = "${bridgeUrl}"\nlocal bridgeUrl = getgenv().BridgeURL or "${DEFAULT_BRIDGE_URL}"\nloadstring(game:HttpGet("http://" .. bridgeUrl .. "/script.luau"))()`;
}

async function copyToClipboard(text) {
  const command =
    process.platform === "darwin"
      ? "pbcopy"
      : process.platform === "win32"
        ? "clip"
        : commandExists("wl-copy")
          ? "wl-copy"
          : commandExists("xclip")
            ? "xclip"
            : null;

  if (!command) {
    log("warn", "Clipboard tool not found; copy the loader from the final output.");
    return;
  }

  if (DRY_RUN) {
    log("dry", `Would copy Roblox loader to clipboard with ${command}`);
    return false;
  }

  await new Promise((resolve, reject) => {
    const args = command === "xclip" ? ["-selection", "clipboard"] : [];
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "pipe"], shell: false });
    let errorOutput = "";
    child.stderr.on("data", (chunk) => {
      errorOutput += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(errorOutput.trim() || `${command} exited with code ${code}`));
    });
    child.stdin.end(text);
  });
  return true;
}

function getFirewallPlan() {
  if (process.platform === "win32") {
    return {
      command: "netsh",
      args: [
        "advfirewall",
        "firewall",
        "add",
        "rule",
        `name=Roblox Executor MCP ${SERVER_PORT}`,
        "dir=in",
        "action=allow",
        "protocol=TCP",
        `localport=${SERVER_PORT}`,
      ],
      label: `Adding Windows firewall rule for TCP ${SERVER_PORT}`,
      success: `Windows firewall allows inbound TCP ${SERVER_PORT}.`,
    };
  }

  if (commandExists("ufw")) {
    return {
      command: "sudo",
      args: ["-n", "ufw", "allow", `${SERVER_PORT}/tcp`],
      label: `Allowing TCP ${SERVER_PORT} with ufw`,
      success: `ufw allows inbound TCP ${SERVER_PORT}.`,
    };
  }

  if (commandExists("firewall-cmd")) {
    return {
      command: "sudo",
      args: ["-n", "firewall-cmd", "--add-port", `${SERVER_PORT}/tcp`, "--permanent"],
      label: `Allowing TCP ${SERVER_PORT} with firewalld`,
      success: `firewalld allows inbound TCP ${SERVER_PORT}; reload firewalld if needed.`,
    };
  }

  return null;
}

async function readSemanticSettingsStatus() {
  const filePath = homePath(".roblox-mcp", "semantic-search.json");
  if (!exists(filePath)) return { exists: false, summary: "" };
  try {
    const settings = await readJson(filePath, {});
    const provider = typeof settings.provider === "string" && settings.provider ? settings.provider : "configured";
    const model =
      provider === "ollama"
        ? settings.ollamaModel
        : provider === "openai"
          ? settings.openaiModel
          : settings.ollamaModel || settings.openaiModel;
    return {
      exists: true,
      summary: `${provider}${typeof model === "string" && model ? ` / ${model}` : ""} at ${filePath}`,
    };
  } catch {
    return { exists: false, summary: "" };
  }
}

async function tryInstallOllama() {
  if (process.platform === "darwin" && commandExists("brew")) {
    await run("brew", ["install", "ollama"], { label: "Installing Ollama with Homebrew" });
    return true;
  }
  if (process.platform === "win32" && commandExists("winget")) {
    await run("winget", ["install", "--id", "Ollama.Ollama", "-e"], { label: "Installing Ollama with winget" });
    return true;
  }
  if (process.platform === "linux" && commandExists("apt-get")) {
    log("warn", "Automatic apt installation is intentionally skipped because Ollama's official installer varies by distro.");
  }
  return false;
}

async function configureHarness(harness, serverEntry, results) {
  try {
    switch (harness.config.kind) {
      case "mcpServersJson":
        await writeMcpServersJson(harness.config.path, serverEntry, harness.config.extra);
        break;
      case "opencodeJson":
        await writeOpencodeJson(harness.config.path, serverEntry);
        break;
      case "kiloJson":
        await writeKiloJson(harness.config.path, serverEntry);
        break;
      case "ampJson":
        await writeAmpJson(harness.config.path, serverEntry);
        break;
      case "codexToml":
        await writeCodexToml(harness.config.path, serverEntry);
        break;
      case "continueYaml":
        await writeContinueYaml(harness.config.path, serverEntry);
        break;
      case "gooseYaml":
        await writeGooseYaml(harness.config.path, serverEntry);
        break;
      case "vibeToml":
        await writeVibeToml(harness.config.path, serverEntry);
        break;
      case "claudeCli":
        await configureClaudeCode(serverEntry);
        break;
      case "vscodeCli":
        await configureVsCodeCopilot(serverEntry);
        break;
      case "manualRecipe":
        results.push({ status: "warn", message: `${harness.name}: printed manual MCP recipe.` });
        return;
      default:
        throw new Error(`Unknown config writer: ${harness.config.kind}`);
    }
    const suffix = harness.config.experimental ? " (experimental path)" : "";
    results.push({ status: "ok", message: `${harness.name}: configured${harness.config.path ? ` ${harness.config.path}` : ""}${suffix}` });
  } catch (error) {
    results.push({ status: "warn", message: `${harness.name}: ${error.message || error}` });
  }
}

async function configureClaudeCode(serverEntry) {
  if (!commandExists("claude")) {
    throw new Error("Claude Code CLI not found. Run manually: claude mcp add --global roblox-executor-mcp -- node " + quote(serverEntry));
  }
  await run("claude", ["mcp", "add", "--global", SERVER_NAME, "--", "node", serverEntry], { label: "Adding Claude Code MCP server" });
}

async function configureVsCodeCopilot(serverEntry) {
  const payload = JSON.stringify({
    name: SERVER_NAME,
    command: "node",
    args: [serverEntry],
  });
  if (!commandExists("code")) {
    throw new Error(`VS Code CLI not found. Run manually: code --add-mcp ${quote(payload)}`);
  }
  await run("code", ["--add-mcp", payload], { label: "Adding VS Code Copilot MCP server" });
}

async function writeMcpServersJson(filePath, serverEntry, extra = {}) {
  const json = await readJson(filePath, {});
  json.mcpServers = json.mcpServers && typeof json.mcpServers === "object" ? json.mcpServers : {};
  json.mcpServers[SERVER_NAME] = { ...mcpServerConfig(serverEntry), ...extra };
  await writeJson(filePath, json);
}

async function writeOpencodeJson(filePath, serverEntry) {
  const json = await readJson(filePath, { "$schema": "https://opencode.ai/config.json" });
  json.mcp = json.mcp && typeof json.mcp === "object" ? json.mcp : {};
  json.mcp[SERVER_NAME] = {
    type: "local",
    command: ["node", serverEntry],
    enabled: true,
  };
  await writeJson(filePath, json);
}

async function writeKiloJson(filePath, serverEntry) {
  const json = await readJson(filePath, {});
  json.mcp = json.mcp && typeof json.mcp === "object" ? json.mcp : {};
  json.mcp[SERVER_NAME] = {
    type: "local",
    command: ["node", serverEntry],
    enabled: true,
  };
  await writeJson(filePath, json);
}

async function writeAmpJson(filePath, serverEntry) {
  const json = await readJson(filePath, {});
  json["amp.mcpServers"] =
    json["amp.mcpServers"] && typeof json["amp.mcpServers"] === "object"
      ? json["amp.mcpServers"]
      : {};
  json["amp.mcpServers"][SERVER_NAME] = mcpServerConfig(serverEntry);
  await writeJson(filePath, json);
}

async function writeCodexToml(filePath, serverEntry) {
  let text = exists(filePath) ? await fs.readFile(filePath, "utf8") : "";
  const block = `[mcp_servers.${SERVER_NAME}]\ncommand = "node"\nargs = ["${tomlString(serverEntry)}"]\n`;
  const escapedName = SERVER_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\n?\\[mcp_servers\\.${escapedName}\\]\\n(?:[^\\[]|\\[(?!mcp_servers\\.))*`, "m");
  text = text.replace(re, "\n");
  text = text.trimEnd();
  text = `${text}${text ? "\n\n" : ""}${block}`;
  await writeText(filePath, text);
}

async function writeContinueYaml(filePath, serverEntry) {
  const markerStart = "# roblox-executor-mcp:start";
  const markerEnd = "# roblox-executor-mcp:end";
  const block = `${markerStart}\nmcpServers:\n  - name: ${SERVER_NAME}\n    command: node\n    args:\n      - ${yamlString(serverEntry)}\n${markerEnd}\n`;
  let text = exists(filePath) ? await fs.readFile(filePath, "utf8") : "";
  const re = new RegExp(`${escapeRe(markerStart)}[\\s\\S]*?${escapeRe(markerEnd)}\\n?`, "m");
  if (re.test(text)) text = text.replace(re, block);
  else text = `${text.trimEnd()}${text.trimEnd() ? "\n\n" : ""}${block}`;
  await writeText(filePath, text);
}

async function writeGooseYaml(filePath, serverEntry) {
  const markerStart = "# roblox-executor-mcp:start";
  const markerEnd = "# roblox-executor-mcp:end";
  const block = `${markerStart}\nextensions:\n  ${SERVER_NAME}:\n    command: node\n    args:\n      - ${yamlString(serverEntry)}\n    enabled: true\n    type: stdio\n${markerEnd}\n`;
  let text = exists(filePath) ? await fs.readFile(filePath, "utf8") : "";
  const re = new RegExp(`${escapeRe(markerStart)}[\\s\\S]*?${escapeRe(markerEnd)}\\n?`, "m");
  if (re.test(text)) text = text.replace(re, block);
  else text = `${text.trimEnd()}${text.trimEnd() ? "\n\n" : ""}${block}`;
  await writeText(filePath, text);
}

async function writeVibeToml(filePath, serverEntry) {
  let text = exists(filePath) ? await fs.readFile(filePath, "utf8") : "";
  const block = `[[mcp_servers]]\nname = "${SERVER_NAME}"\ntransport = "stdio"\ncommand = "node"\nargs = ["${tomlString(serverEntry)}"]\n`;
  const re = new RegExp(`\\n?\\[\\[mcp_servers\\]\\]\\nname = "${escapeRe(SERVER_NAME)}"\\n(?:[^\\[]|\\[(?!\\[mcp_servers\\]\\]))*`, "m");
  text = text.replace(re, "\n");
  text = text.trimEnd();
  text = `${text}${text ? "\n\n" : ""}${block}`;
  await writeText(filePath, text);
}

function mcpServerConfig(serverEntry) {
  return { command: "node", args: [serverEntry] };
}

async function run(command, args, options = {}) {
  if (DRY_RUN) {
    log("dry", `${options.label || command}: ${[command, ...args.map(quote)].join(" ")}`);
    return;
  }
  const label = options.label || [command, ...args].join(" ");
  const spinner = startSpinner(label);
  let output = "";
  await new Promise((resolve, reject) => {
    const commandToRun = spawnCommand(command);
    const useShell = process.platform === "win32" && commandToRun.endsWith(".cmd");
    let child;
    try {
      child = spawn(commandToRun, args, {
        cwd: options.cwd || process.cwd(),
        env: { ...process.env, CI: "true" },
        stdio: ["ignore", "pipe", "pipe"],
        shell: useShell,
        windowsHide: true,
      });
    } catch (error) {
      spinner.stop(false);
      reject(error);
      return;
    }
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", (error) => {
      spinner.stop(false);
      reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) {
        spinner.stop(true);
        resolve();
      } else {
        spinner.stop(false);
        const details = output.trim() ? `\n\n${output.trim()}` : "";
        reject(new Error(`${command} exited with code ${code}${details}`));
      }
    });
  });
}

async function selectHarnesses(initial) {
  const state = {
    cursor: 0,
    search: "",
    selected: new Set(initial),
    mode: "list",
  };
  const stdin = process.stdin;
  readline.emitKeypressEvents(stdin);
  if (stdin.isTTY) stdin.setRawMode(true);
  enterAlternateScreen();
  hideCursor();

  return await new Promise((resolve) => {
    const cleanup = () => {
      if (stdin.isTTY) stdin.setRawMode(false);
      showCursor();
      process.stdout.write("\x1b[2J\x1b[H");
      leaveAlternateScreen();
      stdin.off("keypress", onKey);
      stdin.pause();
    };
    const visibleItems = () => {
      const q = state.search.trim().toLowerCase();
      return ALL_HARNESSES.filter((h) => !q || h.name.toLowerCase().includes(q));
    };
    const render = () => {
      const items = visibleItems();
      if (state.cursor >= items.length) state.cursor = Math.max(0, items.length - 1);
      process.stdout.write("\x1b[2J\x1b[H");
      printBanner();
      console.log(`${colors.green}◆${colors.reset} Which harnesses do you want to install Roblox Executor MCP into?\n`);
      console.log(`${colors.green}Selected:${colors.reset} ${formatSelection(state.selected)}\n`);
      let currentGroup = "";
      const windowed = items.slice(Math.max(0, state.cursor - 9), state.cursor + 18);
      for (const item of windowed) {
        if (item.group !== currentGroup) {
          currentGroup = item.group;
          console.log(`  ${colors.gray}──${colors.reset} ${colors.bold}${currentGroup}${colors.reset} ${colors.gray}${"─".repeat(Math.max(8, 32 - currentGroup.length))}${colors.reset}`);
        }
        const active = item === items[state.cursor];
        const marker = state.selected.has(item.id) ? `${colors.green}●${colors.reset}` : `${colors.gray}○${colors.reset}`;
        const pointer = active ? `${colors.cyan}›${colors.reset}` : " ";
        const support = item.config?.experimental ? ` ${colors.yellow}experimental${colors.reset}` : "";
        const label = active ? `${colors.inverse}${item.name}${colors.reset}` : item.name;
        console.log(`${pointer} ${marker} ${label}${support}`);
      }
      if (items.length > windowed.length) console.log(colors.gray + `  ${items.length - windowed.length} more match the search` + colors.reset);
      console.log(`\n${colors.gray}Search:${colors.reset} ${state.search}${state.mode === "search" ? "█" : ""}`);
      console.log(`${colors.gray}↑↓ move, space select, a all, / search, enter confirm, q quit${colors.reset}`);
    };
    const onKey = (_str, key) => {
      const items = visibleItems();
      if (key.name === "c" && key.ctrl) {
        cleanup();
        process.exit(130);
      }
      if (state.mode === "search") {
        if (key.name === "return" || key.name === "escape") state.mode = "list";
        else if (key.name === "backspace") state.search = state.search.slice(0, -1);
        else if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) state.search += key.sequence;
        state.cursor = 0;
        render();
        return;
      }
      if (key.name === "down") state.cursor = Math.min(items.length - 1, state.cursor + 1);
      else if (key.name === "up") state.cursor = Math.max(0, state.cursor - 1);
      else if (key.name === "space" && items[state.cursor]) toggle(state.selected, items[state.cursor].id);
      else if (key.name === "a") {
        const allVisibleSelected = items.every((item) => state.selected.has(item.id));
        for (const item of items) allVisibleSelected ? state.selected.delete(item.id) : state.selected.add(item.id);
      } else if (key.name === "slash") state.mode = "search";
      else if (key.name === "backspace") state.search = state.search.slice(0, -1);
      else if (key.name === "q" || key.name === "escape") {
        cleanup();
        process.exit(0);
      } else if (key.name === "return") {
        cleanup();
        resolve(state.selected);
        return;
      }
      render();
    };
    stdin.on("keypress", onKey);
    render();
  });
}

async function askInput(label, fallback) {
  showCursor();
  const answer = await prompt(`${colors.bold}${label}${colors.reset} ${colors.gray}(${fallback})${colors.reset}: `);
  hideCursor();
  return answer.trim() || fallback;
}

async function askYesNo(label, fallback) {
  showCursor();
  const answer = await prompt(`${colors.bold}${label}${colors.reset} ${colors.gray}${fallback ? "(Y/n)" : "(y/N)"}${colors.reset}: `);
  hideCursor();
  if (!answer.trim()) return fallback;
  return /^y(es)?$/i.test(answer.trim());
}

function prompt(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function printBanner() {
  const title = "Roblox Executor MCP";
  const subtitle = "provider setup console";
  const hint = "Pick clients, build this repo, write MCP config where known.";
  const width = Math.max(62, visibleLength(title) + visibleLength(subtitle) + 5, visibleLength(hint) + 2);
  console.log(colors.cyan + `╭${"─".repeat(width)}╮` + colors.reset);
  console.log(colors.cyan + "│" + colors.reset + padAnsi(` ${colors.bold}${title}${colors.reset}  ${colors.gray}${subtitle}${colors.reset}`, width) + colors.cyan + "│" + colors.reset);
  console.log(colors.cyan + `╰${"─".repeat(width)}╯` + colors.reset);
  console.log(` ${colors.gray}${hint}${colors.reset}\n`);
}

function formatSelection(selected) {
  const names = ALL_HARNESSES.filter((h) => selected.has(h.id)).map((h) => h.name);
  if (!names.length) return colors.gray + "none" + colors.reset;
  return names.join(", ");
}

function section(title) {
  console.log(`\n${colors.cyan}${colors.bold}${title}${colors.reset}`);
}

function log(status, message) {
  const icon = {
    ok: `${colors.green}◆${colors.reset}`,
    warn: `${colors.yellow}◆${colors.reset}`,
    info: `${colors.cyan}◇${colors.reset}`,
    run: `${colors.purple}●${colors.reset}`,
    skip: `${colors.gray}◇${colors.reset}`,
    dry: `${colors.yellow}◇${colors.reset}`,
  }[status] || `${colors.gray}◇${colors.reset}`;
  console.log(`${icon} ${message}`);
}

function startSpinner(label) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let index = 0;
  let active = process.stdout.isTTY;
  if (!active) {
    log("run", label);
    return { stop: (ok) => ok && undefined };
  }

  const render = () => {
    process.stdout.write(`\r${colors.purple}${frames[index++ % frames.length]}${colors.reset} ${label} ${progressBar(index)}`);
  };
  render();
  const timer = setInterval(render, 80);
  return {
    stop(ok) {
      if (!active) return;
      active = false;
      clearInterval(timer);
      const icon = ok ? `${colors.green}◆${colors.reset}` : `${colors.red}◆${colors.reset}`;
      process.stdout.write(`\r\x1b[2K${icon} ${label}\n`);
    },
  };
}

function progressBar(step) {
  const width = 14;
  const filled = step % (width + 1);
  return `${colors.gray}[${colors.reset}${colors.cyan}${"=".repeat(filled)}${colors.reset}${colors.gray}${" ".repeat(width - filled)}]${colors.reset}`;
}

async function readJson(filePath, fallback) {
  if (!exists(filePath)) return structuredClone(fallback);
  const raw = await fs.readFile(filePath, "utf8");
  try {
    return JSON.parse(stripJsonComments(raw));
  } catch (error) {
    throw new Error(`Could not parse ${filePath}: ${error.message}`);
  }
}

async function writeJson(filePath, value) {
  await writeText(filePath, JSON.stringify(value, null, 2) + "\n");
}

async function writeText(filePath, text) {
  if (DRY_RUN) {
    log("dry", `Would write ${filePath}`);
    return;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  if (exists(filePath)) await fs.copyFile(filePath, `${filePath}.bak`);
  await fs.writeFile(filePath, text, "utf8");
}

function exists(filePath) {
  return fsSync.existsSync(filePath);
}

function isGitRepository(dir) {
  return exists(path.join(dir, ".git"));
}

function commandExists(command) {
  const probe = process.platform === "win32" ? "where" : "which";
  return spawnSync(probe, [command], { stdio: "ignore", shell: false }).status === 0;
}

function spawnCommand(command) {
  if (process.platform !== "win32") return command;
  if (command.endsWith(".cmd") || command.endsWith(".exe")) return command;
  if (["npm", "pnpm", "yarn", "code", "claude"].includes(command)) return `${command}.cmd`;
  return command;
}

function homePath(...parts) {
  return path.join(os.homedir(), ...parts);
}

function expandHome(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function vscodeGlobalStoragePath(...parts) {
  const appData =
    process.platform === "win32"
      ? process.env.APPDATA || homePath("AppData", "Roaming")
      : process.platform === "darwin"
        ? homePath("Library", "Application Support")
        : process.env.XDG_CONFIG_HOME || homePath(".config");
  const codeRoot = process.platform === "darwin" ? path.join(appData, "Code") : path.join(appData, "Code");
  return path.join(codeRoot, "User", "globalStorage", ...parts);
}

function vscodeSettingsPath() {
  const appData =
    process.platform === "win32"
      ? process.env.APPDATA || homePath("AppData", "Roaming")
      : process.platform === "darwin"
        ? homePath("Library", "Application Support")
        : process.env.XDG_CONFIG_HOME || homePath(".config");
  return path.join(appData, "Code", "User", "settings.json");
}

function gooseConfigPath() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || homePath("AppData", "Roaming"), "Block", "goose", "config", "config.yaml");
  }
  return homePath(".config", "goose", "config.yaml");
}

function claudeDesktopConfigPath() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || homePath("AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  }
  if (process.platform === "darwin") {
    return homePath("Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  return homePath(".config", "Claude", "claude_desktop_config.json");
}

function stripJsonComments(input) {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function tomlString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function quote(value) {
  const s = String(value);
  return /\s/.test(s) ? JSON.stringify(s) : s;
}

function visibleLength(value) {
  return stripAnsi(value).length;
}

function padAnsi(value, width) {
  return value + " ".repeat(Math.max(0, width - visibleLength(value)));
}

function stripAnsi(value) {
  return String(value).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function toggle(set, value) {
  if (set.has(value)) set.delete(value);
  else set.add(value);
}

function hideCursor() {
  if (process.stdout.isTTY) process.stdout.write("\x1b[?25l");
}

function showCursor() {
  if (process.stdout.isTTY) process.stdout.write("\x1b[?25h");
}

function enterAlternateScreen() {
  if (process.stdout.isTTY) process.stdout.write("\x1b[?1049h\x1b[2J\x1b[H");
}

function leaveAlternateScreen() {
  if (process.stdout.isTTY) process.stdout.write("\x1b[?1049l");
}
