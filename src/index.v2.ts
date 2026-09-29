// opencode-token-optimizer v2 — port of the v1 plugin (src/index.ts) to the OpenCode 2.x plugin API.
// Default entry stays src/index.ts (v1); this entry builds to dist/index.v2.js.
// Verified on OpenCode 2.0.16. On pre-2.0 hosts the guards skip registration (no crash).

const taskRegistry = new Map<string, { description: string }>();
const STOP_WORDS = new Set(["the", "a", "an", "in", "to", "for", "of", "and", "or", "is", "are"]);

function getSignificantWords(text: string): string[] {
  return text.toLowerCase().split(/[\s,.;:!?()]+/).filter((w) => w.length > 0 && !STOP_WORDS.has(w));
}

function calculateOverlap(qw: string[], dw: string[]): number {
  if (qw.length === 0) return 0;
  const common = qw.filter((w) => dw.includes(w)).length;
  return common / qw.length;
}

const CONCERN_DELIMITER = new RegExp("(?:\\n\\n|\\n(?=[A-Z][a-z]+)|(?:^|(?<=\\.))\\s+(?=[A-Z][a-z]+\\s))", "g");
const FILE_PATH_PATTERN = /(?:[\w-]+\.[\w-]+(?:\/[\w-]+)*|[\/][\w\-./]+)/g;

function summarizeConcern(text: string): string {
  const paths = text.match(FILE_PATH_PATTERN);
  if (paths && paths.length) return paths.join(", ");
  const funcs = text.match(/\b[a-zA-Z_]\w+(?=\s*\()/g);
  if (funcs && funcs.length) return funcs.slice(0, 3).join(", ");
  const cleaned = text.replace(/[,;.].*$/, "").trim();
  return cleaned.length > 60 ? cleaned.substring(0, 57) + "..." : cleaned;
}

function extractConcerns(prompt: string): string[] {
  const segs = prompt.split(CONCERN_DELIMITER).map((s) => s.trim()).filter((s) => s.length > 0);
  if (segs.length <= 1) return [];
  return segs.map(summarizeConcern);
}

function trackTask(args: { taskId: string; description: string }): { duplicate: boolean; existingTask?: string } {
  if (taskRegistry.has(args.taskId))
    return { duplicate: true, existingTask: taskRegistry.get(args.taskId)!.description };
  taskRegistry.set(args.taskId, { description: args.description });
  return { duplicate: false };
}

function checkDuplicate(args: { query: string }): { isDuplicate: boolean; matchedTask?: string } {
  const qw = getSignificantWords(args.query);
  if (qw.length === 0) return { isDuplicate: false };
  for (const [, e] of taskRegistry) {
    const dw = getSignificantWords(e.description);
    if (dw.length === 0) continue;
    if (calculateOverlap(qw, dw) > 0.5) return { isDuplicate: true, matchedTask: e.description };
  }
  return { isDuplicate: false };
}

function validateTaskScope(args: {
  prompt?: string;
  maxConcerns?: number;
}): { valid: boolean; concerns: string[]; suggestion: string } {
  try {
    const { prompt, maxConcerns = 1 } = args;
    if (!prompt || !prompt.trim()) return { valid: true, concerns: [], suggestion: "" };
    const concerns = extractConcerns(prompt);
    if (concerns.length > maxConcerns)
      return {
        valid: false,
        concerns,
        suggestion: `Split into ${concerns.length} separate tasks. Each task should focus on one concern.`,
      };
    return { valid: true, concerns: [], suggestion: "" };
  } catch (e) {
    console.warn("[token-optimizer-v2] validateTaskScope failed:", e);
    return { valid: true, concerns: [], suggestion: "" };
  }
}

const PRE_COMPUTE_GUIDANCE = `
## Pre-computation guidance
Before calling tools, verify:
1. Have you already read this file in this session? (check conversation)
2. Is this file likely to exist? (check known paths from prior tool results)
3. Can you combine this with another call? (batch independent reads)
If you already have the info, use it directly instead of re-reading.`;

export const TokenOptimizerV2Plugin = {
  id: "token-optimizer-v2",
  setup: async (ctx: any) => {
    if (ctx?.tool && typeof ctx.tool.transform === "function") {
      ctx.tool.transform((editor: any) => {
        editor.add({
          name: "track_task",
          description: "Register a task to prevent duplicate delegation",
          input: {
            taskId: { type: "string", description: "Unique identifier for this task" },
            description: { type: "string", description: "What this task will do" },
          },
          execute: async (a: any) => JSON.stringify(trackTask(a)),
        });
        editor.add({
          name: "check_duplicate",
          description: "Check if work has already been delegated",
          input: {
            query: { type: "string", description: "Description of work about to do" },
          },
          execute: async (a: any) => JSON.stringify(checkDuplicate(a)),
        });
        editor.add({
          name: "validate_task_scope",
          description:
            "Validate that a task prompt focuses on ONE concern (not multiple). Returns detected concerns so the orchestrator can split into separate tasks.",
          input: {
            prompt: { type: "string", description: "The task prompt to validate for single-concern focus" },
            maxConcerns: { type: "number", description: "Maximum number of concerns to allow (default: 1)", default: 1 },
          },
          execute: async (a: any) => JSON.stringify(validateTaskScope(a), null, 2),
        });
      });
    }
    if (ctx?.session && typeof ctx.session.hook === "function") {
      ctx.session.hook("context", async (event: any) => {
        if (event?.system && Array.isArray(event.system)) {
          // OpenCode v2 validates `system` against LLM.SystemPart, which is
          // { type: "text", text: string }. Pushing a bare string fails schema
          // validation; once it lands at system[4] or later the whole request
          // fails, which breaks every turn from this session including subagents.
          event.system.push({ type: "text", text: PRE_COMPUTE_GUIDANCE });
        }
      });
    }
  },
};

export default TokenOptimizerV2Plugin;
