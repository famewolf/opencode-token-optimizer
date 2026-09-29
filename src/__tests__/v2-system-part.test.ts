import { describe, expect, test } from "bun:test";
import TokenOptimizerV2Plugin from "../index.v2.js";

/**
 * Drive the v2 plugin's setup() and return the `system` array after its
 * "context" hook has run.
 */
async function runContextHook(event: any): Promise<any[]> {
  const hooks: Array<(e: any) => Promise<void> | void> = [];
  const ctx = {
    tool: { transform: (fn: any) => fn({ add: () => {} }) },
    session: {
      hook: (name: string, cb: any) => {
        if (name === "context") hooks.push(cb);
      },
    },
  };
  await TokenOptimizerV2Plugin.setup(ctx);
  expect(hooks).toHaveLength(1);
  await hooks[0](event);
  return event.system;
}

describe("v2 pre-compute guidance", () => {
  // Regression: anomalyco/opencode#51269. The context event's `system` array is
  // validated against LLM.SystemPart, which is { type: "text", text: string }.
  // Pushing a bare string fails schema validation, and once such an entry lands
  // at system[4] or later the entire request fails, so the session looks alive
  // but can never complete a turn.
  test("appends a SystemPart, never a bare string", async () => {
    const system = await runContextHook({ system: [] });
    expect(system).toHaveLength(1);
    expect(typeof system[0]).toBe("object");
    expect(system[0]).not.toBeNull();
    expect(Array.isArray(system[0])).toBe(false);
    expect(system[0].type).toBe("text");
    expect(typeof system[0].text).toBe("string");
  });

  test("carries the guidance text, not an empty shell", async () => {
    const system = await runContextHook({ system: [] });
    expect(system[0].text).toContain("Pre-computation guidance");
  });

  test("appends without disturbing entries already in the array", async () => {
    const existing = { type: "text", text: "a prior system part" };
    const system = await runContextHook({ system: [existing] });
    expect(system).toHaveLength(2);
    expect(system[0]).toBe(existing);
    expect(system[1].type).toBe("text");
    expect(typeof system[1].text).toBe("string");
  });

  test("leaves an event that carries no system array alone", async () => {
    const event: any = {};
    await runContextHook(event);
    expect(event.system).toBeUndefined();
  });
});
