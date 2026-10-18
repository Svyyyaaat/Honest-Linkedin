import { cleanOutput, buildSystemPrompt } from "../src/prompt.js";
import assert from "assert/strict";
const cases = [
  ["<drafts>\n1. A\n2. B\n3. C\n</drafts>\n<final>The real one.</final>", "The real one."],
  ["<drafts>1. A</drafts><final>\n\"Quoted final.\"\n</final>", "Quoted final."],
  ["<drafts>\n1. First idea.\n2. Second idea.\n", "Second idea."],             // truncated before <final>
  ["<drafts>1. x</drafts>\n<final>Cut off mid", "Cut off mid"],                 // truncated inside <final>
  ["<think>hmm</think>Honest: plain answer.", "plain answer."],
  ["\"Honest: I need attention.\"", "I need attention."],
  ["We sold. Oracle shut it down.", "We sold. Oracle shut it down."],
];
for (const [inp, want] of cases) assert.equal(cleanOutput(inp), want, JSON.stringify(inp));
assert.ok(buildSystemPrompt(true).includes("<final>") && !buildSystemPrompt(false).includes("<final>"));
assert.ok(buildSystemPrompt(false).endsWith("Reply with only the honest version."));
console.log("cleanOutput ok");
