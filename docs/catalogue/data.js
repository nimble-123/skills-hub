// The drawers. Paths are copied from crates/core/src/tools.rs — the tool
// registry is the source of truth, this is only a picture of it. The cards
// inside each drawer are example items, the way the demo build uses fixtures.

export const TYPES = {
  skill: { label: "Skill", plural: "skills", color: "#b9a6ff", slot: 0 },
  agent: { label: "Agent", plural: "agents", color: "#64d6c2", slot: 1 },
  command: { label: "Command", plural: "commands", color: "#e0b070", slot: 2 },
  rule: { label: "Rule", plural: "rules", color: "#f09aad", slot: 3 },
};

// Four by four, in the order the README lists them.
export const TOOLS = [
  {
    id: "claude-code",
    name: "Claude Code",
    root: "~/.claude",
    paths: { skill: "~/.claude/skills", agent: "~/.claude/agents", command: "~/.claude/commands", rule: "~/.claude/CLAUDE.md" },
    project: { rule: "CLAUDE.md" },
    singleRule: "CLAUDE.md",
  },
  {
    id: "cursor",
    name: "Cursor",
    root: "~/.cursor",
    paths: { skill: "~/.cursor/skills", agent: "~/.cursor/agents", rule: "~/.cursor/rules" },
  },
  {
    id: "codex",
    name: "Codex",
    root: "~/.codex",
    paths: { skill: "~/.codex/skills", agent: "~/.codex/agents", command: "~/.codex/prompts" },
  },
  {
    id: "opencode",
    name: "OpenCode",
    root: "~/.config/opencode",
    paths: { skill: "~/.config/opencode/skills", agent: "~/.config/opencode/agents", command: "~/.config/opencode/commands" },
    project: { skill: ".opencode/skills", agent: ".opencode/agents", command: ".opencode/commands" },
  },
  {
    id: "antigravity",
    name: "Antigravity",
    root: "~/.gemini/config",
    paths: { skill: "~/.gemini/config/skills" },
    unconfirmed: { agent: "~/.gemini/config/agents", command: "~/.gemini/config/workflows" },
    project: { agent: ".agents/agents", command: ".agents/workflows", rule: ".agents/rules" },
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    root: "~/.copilot",
    paths: { skill: "~/.copilot/skills" },
    project: { command: ".github/prompts", rule: ".github/instructions" },
  },
  {
    id: "cline",
    name: "Cline",
    root: "~/Documents/Cline",
    paths: { rule: "~/Documents/Cline/Rules" },
    unconfirmed: { skill: "~/Documents/Cline/Skills", command: "~/Documents/Cline/Workflows" },
    project: { skill: ".cline/skills", command: ".clinerules/workflows", rule: ".clinerules" },
  },
  {
    id: "trae",
    name: "Trae",
    root: "~/.trae",
    paths: { skill: "~/.trae/skills", rule: "~/.trae/user_rules" },
    unconfirmed: { agent: "~/.trae/agents" },
    project: { skill: ".trae/skills", rule: ".trae/rules" },
  },
  {
    id: "windsurf",
    name: "Windsurf",
    root: "~/.codeium/windsurf",
    paths: { skill: "~/.codeium/windsurf/skills", rule: "~/.windsurf/rules" },
  },
  {
    id: "goose",
    name: "Goose",
    root: "~/.config/goose",
    paths: { skill: "~/.config/goose/skills" },
    project: { skill: ".goose/skills" },
  },
  {
    id: "hermes",
    name: "Hermes",
    root: "~/.hermes",
    paths: { skill: "~/.hermes/skills" },
    unconfirmed: { agent: "~/.hermes/agents", command: "~/.hermes/commands", rule: "~/.hermes/rules" },
  },
  {
    id: "pi",
    name: "Pi",
    root: "~/.pi/agent",
    paths: { skill: "~/.pi/agent/skills" },
    project: { skill: ".pi/skills", rule: "AGENTS.md" },
    singleRule: "AGENTS.md",
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    root: "~/.gemini",
    paths: { command: "~/.gemini/commands" },
    unconfirmed: { skill: "~/.gemini/config/skills" },
  },
  {
    id: "roo-code",
    name: "Roo Code",
    root: "~/.roo",
    paths: { rule: "~/.roo/rules" },
  },
  {
    id: "continue",
    name: "Continue",
    root: "<project>/.continue",
    paths: {},
    project: { command: ".continue/prompts", rule: ".continue/rules" },
  },
  {
    id: "global",
    name: "Shared",
    root: "~/.agents/skills",
    paths: { skill: "~/.agents/skills" },
  },
];

const EXAMPLES = {
  skill: [
    ["pdf-extract", "Pull the text and tables out of a PDF."],
    ["review-sql", "Read a migration before it is run."],
    ["release-notes", "Draft notes from the commits since a tag."],
    ["frontend-design", "Lay out a page from a rough sketch."],
    ["test-plan", "List what a change needs tested."],
  ],
  agent: [
    ["code-reviewer", "A second pair of eyes on a diff."],
    ["test-runner", "Runs the suite and reads the failures."],
    ["researcher", "Reads widely before answering."],
  ],
  command: [
    ["deploy-check", "Everything to confirm before a deploy."],
    ["fix-issue", "Reproduce, fix, and test an issue."],
    ["standup", "Yesterday, today, and what is blocked."],
  ],
  rule: [
    ["house-style", "How this codebase writes things."],
    ["no-secrets", "Never commit a key, token or .env."],
  ],
};

const ORDER = ["skill", "agent", "command", "rule"];

function where(tool, type) {
  if (tool.paths[type]) return { dir: tool.paths[type], scope: "global" };
  if (tool.project?.[type]) return { dir: `<project>/${tool.project[type]}`, scope: "project" };
  return null;
}

function fileFor(tool, type, name) {
  const w = where(tool, type);
  if (!w) return "";
  if (type === "rule" && tool.singleRule && w.dir.endsWith(tool.singleRule)) return w.dir;
  if (type === "skill") return `${w.dir}/${name}/SKILL.md`;
  return `${w.dir}/${name}.md`;
}

/** Example cards for one drawer: up to six, spread over the types it keeps. */
export function cardsFor(tool, index) {
  const types = ORDER.filter((t) => where(tool, t));
  const out = [];
  const used = new Set();
  let k = 0;
  while (out.length < 6 && types.length) {
    const type = types[k % types.length];
    const pool = EXAMPLES[type];
    const pick = pool[(index + Math.floor(k / types.length)) % pool.length];
    let [name, description] = pick;
    if (type === "rule" && tool.singleRule) {
      if (used.has(tool.singleRule)) {
        k++;
        if (k > 24) break;
        continue;
      }
      name = tool.singleRule;
      description = "Instructions read at the start of every session.";
    }
    const key = `${type}:${name}`;
    if (!used.has(key) && !used.has(name)) {
      used.add(key);
      used.add(name);
      out.push({ type, name, description, path: fileFor(tool, type, name) });
    }
    k++;
    if (k > 24) break;
  }
  return out;
}

/** The lines of a drawer's guide card: every folder it reads, by type. */
export function guideLines(tool) {
  const lines = [];
  for (const t of ORDER) {
    if (tool.paths[t]) lines.push({ type: t, path: tool.paths[t], note: "" });
  }
  for (const t of ORDER) {
    if (tool.project?.[t]) lines.push({ type: t, path: `<project>/${tool.project[t]}`, note: "project" });
  }
  for (const t of ORDER) {
    if (tool.unconfirmed?.[t]) lines.push({ type: t, path: tool.unconfirmed[t], note: "unconfirmed" });
  }
  return lines;
}
