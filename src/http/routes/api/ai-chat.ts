import type { IncomingMessage, ServerResponse } from "http";
import { WS_PORT } from "../../../config.js";
import { readJsonBody } from "../../body.js";

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface ChatRequest {
  clientId?: string;
  messages: ChatMessage[];
  config: { baseUrl?: string; apiKey: string; model: string };
}

const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "get_game_info",
      description: "Get current Roblox place/universe metadata (PlaceId, GameId, PlaceVersion). Cheap, call this first to orient yourself.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "search_instances",
      description: "Search the DataModel for instances. selector is a Roblox path like 'workspace.Part' or a class query like '$Humanoid'.",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "Path or $ClassName selector" },
          root: { type: "string", description: "Root instance path, default 'game'" },
          limit: { type: "number", description: "Max results, default 50, max 100" },
        },
        required: ["selector"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_descendants_tree",
      description: "Get a tree of descendants under a root instance.",
      parameters: {
        type: "object",
        properties: {
          root: { type: "string", description: "Root path e.g. 'workspace'" },
          maxDepth: { type: "number" },
          classFilter: { type: "string" },
        },
        required: ["root"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "script_grep",
      description: "Regex/literal search across all decompiled scripts on the client. Use to find code by symbol or string.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          literal: { type: "boolean", description: "Treat query as literal string, default false (regex)" },
          caseSensitive: { type: "boolean", description: "Default true" },
          limit: { type: "number", description: "Max files, default 50, max 100" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "semantic_search",
      description: "Semantic vector search over scripts. Requires the embedding provider to be configured. Use for fuzzy/conceptual queries when grep doesn't work.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_script_content",
      description: "Read the full source of a script by its path. Use after script_grep / semantic_search to inspect specific files.",
      parameters: {
        type: "object",
        properties: {
          scriptPath: { type: "string" },
          startLine: { type: "number" },
          endLine: { type: "number" },
        },
        required: ["scriptPath"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_console_output",
      description: "Fetch recent Roblox client console output.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number" },
          filter: { type: "string" },
          logsOrder: { type: "string", enum: ["newest", "oldest"] },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_data_by_code",
      description: "Run a Luau snippet on the client and return its return value as a string. The code MUST `return` a value. Synchronous, fast inspection.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "Luau code that returns a value, e.g. 'return #game.Players:GetPlayers()'" },
          timeout: { type: "number" },
        },
        required: ["code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "execute",
      description: "Fire-and-forget execute Luau code on the connected Roblox client. Use this to actually RUN scripts the user asks you to make (e.g. fly script with GUI). Identity level 8 is already set.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "Full Luau source to execute on the client" },
        },
        required: ["code"],
      },
    },
  },
];

const TOOL_NAME_MAP: Record<string, string> = {
  get_game_info: "get-game-info",
  search_instances: "search-instances",
  get_descendants_tree: "get-descendants-tree",
  script_grep: "script-grep",
  semantic_search: "semantic-search",
  get_script_content: "get-script-content",
  get_console_output: "get-console-output",
  get_data_by_code: "get-data-by-code",
  execute: "execute",
};

const SYSTEM_PROMPT = `You are MŌKAH-AI, a coding assistant embedded in a Roblox MCP dashboard, similar to Claude or Antigravity. You are connected to a live Roblox client through a set of MCP tools.

Workflow:
1. When the user asks you to write a script (fly, ESP, GUI, etc.), use the tools to gather context FIRST:
   - get_game_info to learn the place
   - script_grep / semantic_search / get_script_content to understand existing code, remotes, classes
   - search_instances / get_descendants_tree to inspect the live DataModel
   - get_data_by_code for quick Luau probes (must \`return\` a value)
2. Then write the Luau script. Prefer modern executor-friendly APIs.
3. If the user clearly wants the script to run, call \`execute\` with the final code. Otherwise just respond with the code in a fenced \`\`\`lua block.
4. Be concise. Don't narrate every tool call.

Tools dispatch to the user's currently-selected Roblox client. If a tool returns an error about "No active client", tell the user to connect a client.`;

const MAX_STEPS = 10;

async function callTool(
  baseUrl: string,
  type: string,
  clientId: string | undefined,
  params: Record<string, unknown>
): Promise<string> {
  try {
    const resp = await fetch(baseUrl + "/api/tool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, ...(clientId ? { clientId } : {}), ...params }),
    });
    const data = (await resp.json()) as Record<string, unknown>;
    if (data.error) return `Error: ${data.error}`;
    if (data.result !== undefined) return String(data.result);
    if (data.jobId && data.progressUrl) {
      // Poll progress
      const progressUrl = baseUrl + (data.progressUrl as string);
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1000));
        const pr = await fetch(progressUrl);
        const job = (await pr.json()) as Record<string, unknown>;
        if (job.status === "done") return String(job.result ?? "Done.");
        if (job.status === "failed") return `Error: ${job.error ?? "unknown"}`;
      }
      return "Error: Timed out waiting for progress job.";
    }
    return JSON.stringify(data);
  } catch (err) {
    return `Error: ${(err as Error).message}`;
  }
}

function truncate(s: string, n = 12000): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + `\n…[truncated ${s.length - n} chars]`;
}

export async function POST(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readJsonBody<ChatRequest>(req);
    const { clientId, messages, config } = body;

    if (!config?.apiKey) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing API key. Open chat settings and add one." }));
      return;
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing messages." }));
      return;
    }

    const llmBaseUrl = (config.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
    const model = config.model || "gpt-4o-mini";
    const internalBase = `http://localhost:${WS_PORT}`;

    const convo: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...messages.filter((m) => m.role !== "system"),
    ];

    const trace: { tool: string; args: unknown; result: string }[] = [];

    for (let step = 0; step < MAX_STEPS; step++) {
      const llmResp = await fetch(llmBaseUrl + "/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: convo,
          tools: TOOL_DEFS,
          tool_choice: "auto",
        }),
      });

      if (!llmResp.ok) {
        const errText = await llmResp.text();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: `LLM error ${llmResp.status}: ${errText.slice(0, 400)}`,
            trace,
          })
        );
        return;
      }

      const json = (await llmResp.json()) as {
        choices?: { message?: ChatMessage }[];
      };
      const msg = json.choices?.[0]?.message;
      if (!msg) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "LLM returned no message.", trace }));
        return;
      }

      convo.push(msg);

      const calls = msg.tool_calls;
      if (!calls || calls.length === 0) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            assistant: msg.content ?? "",
            trace,
          })
        );
        return;
      }

      // Execute each tool call
      for (const call of calls) {
        const fnName = call.function.name;
        const realType = TOOL_NAME_MAP[fnName];
        let args: Record<string, unknown> = {};
        try {
          args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          args = {};
        }

        let result: string;
        if (!realType) {
          result = `Error: unknown tool ${fnName}`;
        } else {
          result = await callTool(internalBase, realType, clientId, args);
          result = truncate(result);
        }
        trace.push({ tool: fnName, args, result });
        convo.push({
          role: "tool",
          tool_call_id: call.id,
          name: fnName,
          content: result,
        });
      }
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: `Reached max tool steps (${MAX_STEPS}).`,
        trace,
      })
    );
  } catch (err) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Chat failed: ${(err as Error).message || err}` }));
  }
}
