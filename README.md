# opencode-token-optimizer

A plugin for [OpenCode](https://github.com/opencode-ai/opencode) that reduces token consumption in AI-assisted coding workflows. It applies six optimization patterns across system prompt injection, custom tools, and configuration hooks to cut waste without changing your workflow.

No ML, no analytics, no external API calls, no persistent state. Each pattern is independently toggleable.

---

## Installation

Add the plugin to your `opencode.json` plugin array:

```json
{
  "plugins": [
    {
      "plugin": "opencode-token-optimizer",
      "source": "npm"
    }
  ]
}
```

Or point to a local build:

```json
{
  "plugins": [
    {
      "plugin": "/path/to/opencode-token-optimizer/dist/index.js",
      "source": "local"
    }
  ]
}
```

Then install the package:

```bash
npm install opencode-token-optimizer
# or
bun add opencode-token-optimizer
```

---

## Quick Start

All six patterns are enabled by default. Restart OpenCode after installing and the plugin activates automatically.

To verify it is running, check for `[token-optimizer]` messages at startup:

```
[token-optimizer] Loaded 3 categories from oh-my-openagent.json
[token-optimizer] Injected quick routing rules (maxPromptChars=100, 4 patterns)
```

To disable a pattern you don't need, create a config file (see [CONFIGURATION.md](CONFIGURATION.md)).

---

## Pattern Reference

| # | Pattern | Type | Default | What It Does |
|---|---------|------|---------|--------------|
| 1 | Precise Task Prompts | System prompt injection | Enabled | Injects structured prompting guidelines so AI agents delegate work with specific files, line ranges, and expected outputs. |
| 2 | Anti-Duplication Guard | Custom tools | Enabled | Tracks registered tasks and detects duplicate delegation via word overlap. |
| 3 | Single-Concern Delegation Validator | Custom tool | Enabled | Validates task prompts focus on one concern and flags multi-objective prompts. |
| 4 | Quick Category Routing | Config hook | Enabled | Routes trivial tasks (typos, renames, comments, version bumps) to a cheap, fast AI model. |
| 5 | Pre-Computation Guidance | System prompt injection | Enabled | Instructs the AI to resolve file paths and symbols locally before spawning subagents. |
| 6 | Cut Explore Agent | Hybrid (system prompt + tool) | Enabled | Guides the AI to use direct tools (grep, lsp, ast-grep) instead of expensive explore agents for simple lookups. |

---

## Pattern Details

### Pattern 1: Precise Task Prompts

Injects a guidance block into the system prompt that teaches the AI how to write better task prompts when delegating work. The guidance pushes four rules:

1. Include exact file paths and line ranges (e.g. `src/auth.ts:45-78`)
2. Reference specific function and variable names
3. State the expected output format
4. Ask one clear question per task

This prevents subagents from receiving vague instructions that lead to wasted exploration.

Trigger: always active in the system prompt when enabled. No user-facing tool to call.

---

### Pattern 2: Anti-Duplication Guard

Registers two custom tools that work together to prevent the AI from delegating the same work twice in a session:

- **`track_task`** -- registers a task ID and description in an in-memory registry. Returns a `duplicate: true` response if the same task ID was already registered.
- **`check_duplicate`** -- compares a query description against all registered tasks using word overlap. If the overlap exceeds 50% (after stop word removal), it returns the matched task.

The registry is session-scoped and cleared when OpenCode restarts.

---

### Pattern 3: Single-Concern Delegation Validator

Registers the **`validate_task_scope`** tool. The tool analyzes a task prompt using keyword-based heuristics (no ML or NLP). It splits the prompt on multi-concern keywords:

- `AND` and `ALSO` (all-caps only, to avoid false matches)
- `additionally`, `meanwhile`, `separately` (including capitalized forms)

When multiple concerns are detected, the tool returns them as a list with a suggestion to split into separate tasks. Each concern is summarized by prioritising file paths, then function references, then the first phrase.

This prevents the orchestrator from bundling independent objectives into a single subagent delegation.

---

### Pattern 4: Quick Category Routing

A configuration hook that runs at startup. It reads `oh-my-openagent.json` (from `~/.config/opencode/`) and, if a `quick` category exists, injects routing rules into the in-memory OpenCode configuration.

Tasks are routed to the `quick` category (typically a cheap, fast model like `opencode/mimo-v2.5-free`) when:

- The prompt is shorter than 100 characters, OR
- The prompt matches one of four patterns (case-insensitive): `fix typo`, `rename`, `update comment`, `bump version`

This keeps trivial tasks off expensive models without manual intervention.

---

### Pattern 5: Pre-Computation Guidance

Injects a guidance block into the system prompt that teaches the AI a specific token-saving discipline: resolve file paths, symbol locations, and grep results using direct tools *before* spawning a subagent.

The guidance includes a token cost comparison:

- `grep`, `glob`, or `lsp` for a symbol: ~0.5-2K tokens
- An explore agent to find the same symbol: ~40-60K tokens

This addresses the most common source of token waste in AI-assisted coding: using an expensive agent for what should be a local lookup.

---

### Pattern 6: Cut Explore Agent

A hybrid pattern that combines system prompt guidance with a complexity classification tool.

The system prompt teaches the AI a decision framework: before calling `task(subagent_type="explore", ...)`, ask three questions:

1. Can I answer this with grep, ast_grep_search, or lsp_find_references directly?
2. Is this a single-file question or cross-file synthesis?
3. Is the answer less than 20 lines of code?

Explore agents are reserved for cross-file synthesis, architecture narrative, and open-ended investigation. Everything else should use direct tools.

The **`classify_complexity`** tool supports this with a rule-based classifier. It categorizes prompts as:

- **simple** -- under 100 characters, no file references, action verb match
- **medium** -- 100-500 characters, 1-2 file references (the safe default)
- **complex** -- over 500 characters, or 3+ file references, or 2+ question marks, or complex signal words

The classifier is purely heuristic (~115 lines of logic). It defaults to "medium" when uncertain, never to "complex."

---

## Verification

After installing, check the plugin loaded correctly:

1. **Restart OpenCode** and watch for `[token-optimizer]` log lines at startup. A line confirming routing injection means the config hook fired.

2. **Check tools are registered.** In an OpenCode session, the custom tools `track_task`, `check_duplicate`, `validate_task_scope`, and `classify_complexity` should be available to the AI.

3. **Check system prompt injection.** If system prompt modification is visible in your OpenCode client, you should see XML-wrapped guidance blocks containing `token_optimizer_guidance` markers.

4. **Test quick routing.** Submit a task with a short prompt like "fix typo in header" and check which model handles it. It should route to the `quick` category.

5. **Run the test suite** to confirm everything works in isolation:

```bash
bun test
```

---

## Compatibility

This plugin works alongside **oh-my-openagent** (a category-routing agent orchestrator for OpenCode). The quick category routing pattern (Pattern 4) is specifically designed to integrate with oh-my-openagent's category system, reading `oh-my-openagent.json` to discover available categories.

The plugin is **not** a replacement for oh-my-openagent. They serve different purposes:

- oh-my-openagent routes tasks to specialized agent categories.
- opencode-token-optimizer reduces token waste within any agent workflow.

They can be installed side by side. When both are present, the token optimizer's routing rules supplement oh-my-openagent's category configuration.

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| No `[token-optimizer]` messages at startup | Plugin not loaded | Check `opencode.json` plugin entry and that `dist/index.js` exists |
| Quick routing not working | `quick` category missing from oh-my-openagent.json | Add a `quick` category to your oh-my-openagent.json |
| Config hook warning "Could not read oh-my-openagent.json" | File missing or invalid JSON | Ensure `~/.config/opencode/oh-my-openagent.json` exists and is valid |
| Tools not appearing | Pattern disabled in config | Check `token-optimizer.json` has the pattern set to `true` |
| Transformer warning "no transformer patterns are enabled" | precisePrompts, preComputationGuidance, and cutExploreAgent all disabled | Enable at least one system-prompt-based pattern |

---

## License

MIT

## OpenCode 2.x

- `src/index.v2.ts` — v2 plugin API entry (`{ id, setup }`): registers `track_task` / `check_duplicate` / `validate_task_scope` via `ctx.tool.transform` and pre-computes guidance into the context (`ctx.session.hook('context')`).
- Compiles to `dist/index.v2.js` (no `package.json` change; `tsconfig` already includes `src/**`).
