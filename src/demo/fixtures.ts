/**
 * A library that looks like a real one.
 *
 * Used only by the demo build the screenshots are taken from — the
 * application itself never loads any of this. The shapes come from
 * `bindings.ts`, so a change to a command's return type breaks this at
 * compile time rather than producing a screenshot of something that no
 * longer exists.
 */

import type {
  DashboardReport,
  DiscoverCatalog,
  ItemMetadata,
  ItemType,
  LibrarySnapshot,
  McpServer,
  PluginSource,
  RegistryHit,
  ReviewHandle,
  SettingsView,
  ToolReport,
  UsageStats,
} from "../bindings";
import { isMonoFont, isUiFont } from "../lib/fonts";
import { isThemeId } from "../lib/theme";

type Seed = {
  name: string;
  tool: string;
  type: ItemType;
  description: string;
  tags?: string[];
  favorite?: boolean;
  enabled?: boolean;
  linked?: boolean;
  plugin?: string;
  repo?: string;
  chars?: number;
};

const SEEDS: Seed[] = [
  {
    name: "sap-abap-cds",
    tool: "claude-code",
    type: "skill",
    description:
      "Core Data Services for ABAP: view entities, annotations, associations, access control with DCL, and the built-in functions worth knowing.",
    tags: ["sap", "abap"],
    favorite: true,
    linked: true,
    chars: 41_200,
  },
  {
    name: "sap-btp-developer-guide",
    tool: "claude-code",
    type: "skill",
    description:
      "Building on SAP BTP with CAP or ABAP Cloud — Cloud Foundry and Kyma, HANA Cloud, Fiori, and the way the pieces fit together.",
    tags: ["sap"],
    linked: true,
    chars: 36_800,
  },
  {
    name: "sap-fiori-tools",
    tool: "claude-code",
    type: "skill",
    description:
      "Generating and configuring Fiori Elements applications, page editor and annotations.",
    tags: ["sap", "ui"],
    linked: true,
    chars: 22_400,
  },
  {
    name: "obsidian",
    tool: "claude-code",
    type: "skill",
    description: "Vaults, notes, frontmatter, daily notes and sync, with safe defaults for each.",
    tags: ["notes"],
    linked: true,
    chars: 9_800,
  },
  {
    name: "graphify",
    tool: "claude-code",
    type: "skill",
    description: "Turns anything — code, documents, papers, images — into a knowledge graph.",
    chars: 14_100,
  },
  {
    name: "abap-repo-assessment",
    tool: "claude-code",
    type: "skill",
    description:
      "Assessment and AS-IS documentation for an abapGit repository: architecture, Clean Core, technical debt, S/4HANA readiness.",
    tags: ["sap", "abap"],
    chars: 28_600,
  },
  {
    name: "deep-research",
    tool: "claude-code",
    type: "skill",
    description:
      "Long-running research across many sources, with the findings written up as it goes.",
    repo: "https://github.com/anthropics/skills",
    chars: 11_900,
  },
  {
    name: "skill-creator",
    tool: "claude-code",
    type: "skill",
    description: "Writes a new skill, with the structure and frontmatter the tools expect.",
    repo: "https://github.com/anthropics/skills",
    chars: 8_400,
  },
  {
    name: "pdf",
    tool: "claude-code",
    type: "skill",
    description: "Reading, filling and generating PDF files.",
    tags: ["documents"],
    chars: 6_200,
  },
  {
    name: "xlsx",
    tool: "claude-code",
    type: "skill",
    description: "Spreadsheets: reading them, writing them, and the formula quirks in between.",
    tags: ["documents"],
    chars: 7_700,
  },
  {
    name: "tesseract",
    tool: "claude-code",
    type: "skill",
    description: "Architecture diagrams from a codebase: overview, services, data and flow.",
    plugin: "tesseract@tesseract-skills",
    chars: 18_300,
  },
  {
    name: "sap-architecture",
    tool: "claude-code",
    type: "skill",
    description: "SAP BTP solution diagrams in the SAP Horizon style, as a .drawio file.",
    plugin: "sap-architecture@btp-drawio-skill",
    chars: 12_500,
  },
  {
    name: "review",
    tool: "claude-code",
    type: "command",
    description: "Reviews the working tree for correctness problems before a commit.",
    chars: 2_100,
  },
  {
    name: "release",
    tool: "claude-code",
    type: "command",
    description: "Tags a release, writes the changelog and pushes it.",
    chars: 1_400,
  },
  {
    name: "CLAUDE",
    tool: "claude-code",
    type: "rule",
    description: "",
    chars: 3_900,
  },
  {
    name: "Explore",
    tool: "claude-code",
    type: "agent",
    description: "Read-only search across many files, for when only the conclusion is wanted.",
    favorite: true,
    chars: 2_800,
  },
  {
    name: "Plan",
    tool: "claude-code",
    type: "agent",
    description: "Designs an implementation approach and names the files it would touch.",
    chars: 3_100,
  },
  {
    name: "imagegen",
    tool: "codex",
    type: "skill",
    description: "Generates and edits images from a prompt.",
    chars: 5_600,
  },
  {
    name: "openai-docs",
    tool: "codex",
    type: "skill",
    description: "The current OpenAI platform documentation, offline.",
    chars: 24_900,
  },
  {
    name: "review-agent",
    tool: "codex",
    type: "agent",
    description: "Reviews a diff and reports only what it can defend.",
    chars: 4_300,
  },
  {
    name: "house-style",
    tool: "cursor",
    type: "rule",
    description: "How we write here: naming, comments, and what not to abbreviate.",
    tags: ["team"],
    chars: 1_900,
  },
  {
    name: "no-any",
    tool: "cursor",
    type: "rule",
    description: "TypeScript without escape hatches, and what to do instead of reaching for one.",
    tags: ["team"],
    enabled: false,
    chars: 1_200,
  },
  {
    name: "tdd",
    tool: "opencode",
    type: "skill",
    description: "Write the failing test first, then the smallest thing that passes it.",
    tags: ["practice"],
    chars: 4_800,
  },
  {
    name: "sap-abap",
    tool: "global",
    type: "skill",
    description:
      "ABAP itself: internal tables, ABAP SQL, RAP, CDS, RTTI, field symbols and unit testing, classic through Cloud.",
    tags: ["sap", "abap"],
    chars: 52_400,
  },
  {
    name: "sap-cap-capire",
    tool: "global",
    type: "skill",
    description: "The Cloud Application Programming model: CDL, CQL, services, and deploying them.",
    tags: ["sap"],
    chars: 33_700,
  },
  {
    name: "sap-datasphere",
    tool: "global",
    type: "skill",
    description: "Data Builder, Business Builder, analytic models, replication flows and the CLI.",
    tags: ["sap"],
    chars: 29_100,
  },
];

function toItem(seed: Seed, index: number): ItemMetadata {
  const folder = seed.tool === "global" ? ".agents/skills" : `.${seed.tool.split("-")[0]}`;
  const base = `/Users/you/${folder}/${seed.type}s/${seed.name}`;
  const path = seed.type === "skill" ? `${base}/SKILL.md` : `${base}.md`;

  return {
    entryId: `${seed.name}-${index.toString(16).padStart(6, "0")}`,
    sourcePath: path,
    realPath: seed.linked ? `/Users/you/.agents/skills/${seed.name}/SKILL.md` : path,
    tool: seed.tool,
    type: seed.type,
    projectId: null,
    pluginId: seed.plugin ?? null,
    name: seed.name,
    description: seed.description,
    enabled: seed.enabled ?? true,
    modified: `2026-0${(index % 9) + 1}-1${index % 9}T09:20:00Z`,
    tags: seed.tags ?? [],
    favorite: seed.favorite ?? false,
    collections: seed.tags?.includes("sap") ? ["col-sap"] : [],
    sourceRepo: seed.repo ?? null,
    sourceRef: seed.repo ? "" : null,
    sourceSubpath: seed.repo ? `skills/${seed.name}` : null,
    sourceCommit: seed.repo ? "7f2a9c1b4de3a05c8e1f6d2b93a4c705e8d1f6a2" : null,
  };
}

export const ITEMS: ItemMetadata[] = SEEDS.map(toItem);

export const PLUGINS: PluginSource[] = [
  {
    id: "tesseract@tesseract-skills",
    name: "tesseract",
    group: "tesseract-skills",
    path: "/Users/you/.claude/plugins/cache/tesseract-skills/tesseract/0.1.15",
    toolId: "claude-code",
    enabled: true,
    repoUrl: "https://github.com/tesseract/skills",
  },
  {
    id: "sap-architecture@btp-drawio-skill",
    name: "sap-architecture",
    group: "btp-drawio-skill",
    path: "/Users/you/.claude/plugins/cache/btp-drawio-skill/sap-architecture/1.2.0",
    toolId: "claude-code",
    enabled: true,
    repoUrl: null,
  },
];

export const SNAPSHOT: LibrarySnapshot = {
  items: ITEMS,
  plugins: PLUGINS,
  brokenSymlinks: [
    {
      path: "/Users/you/.claude/skills/peon-ping-log/SKILL.md",
      target: "/opt/homebrew/opt/peon-ping/libexec/skills/peon-ping-log/SKILL.md",
      targetPath: "/opt/homebrew/opt/peon-ping/libexec/skills/peon-ping-log/SKILL.md",
      tool: "claude-code",
      type: "skill",
      projectId: null,
    },
  ],
  warnings: [],
  scannedAt: "2026-09-28T09:24:11Z",
  version: 4,
  orphanCount: 0,
};

/**
 * The palette the screenshot harness asked for with `?theme=…`, if it named
 * one it knows.
 *
 * It belongs in the settings rather than in a call of its own: that way the
 * demo picks a theme the same way the application does, and a break in that
 * path shows up in a screenshot instead of hiding behind a second one.
 */
const asked = new URLSearchParams(window.location.search).get("theme");
export const DEMO_THEME = isThemeId(asked) ? asked : null;

const askedUi = new URLSearchParams(window.location.search).get("font");
const askedMono = new URLSearchParams(window.location.search).get("mono");

export const SETTINGS: SettingsView = {
  settings: {
    schemaVersion: 1,
    metadataFolder: "/Users/you/Vault/AI Skills Manager",
    toolOverrides: {},
    customTools: [],
    projectWorkspaces: [],
    collections: [{ id: "col-sap", name: "SAP", icon: null }],
    sectionOrder: ["types", "extensions", "tools", "projects", "collections"],
    showEmptySidebarRows: false,
    defaultSortOrder: "name-asc",
    defaultEnabledFilter: "all",
    theme: DEMO_THEME ?? "system",
    uiFont: isUiFont(askedUi) ? askedUi : "system",
    monoFont: isMonoFont(askedMono) ? askedMono : "system",
  },
  tools: ["claude-code", "codex", "cursor", "opencode", "global"].map((id) => ({
    id,
    paths: { skill: `~/.${id}/skills` },
    projectPaths: {},
    unconfirmedPaths: {},
    disabled: false,
    custom: false,
    singleFileRule: id === "claude-code",
    ruleAdditionalPaths: [],
    ruleAdditionalProjectPaths: [],
    builtInDirnames: [],
    pluginsRegistry: null,
    pluginsPaths: [],
    pluginsSettingsPath: null,
    pluginPaths: {},
    mcpConfigPath: null,
    projectMcpConfigPath: null,
    mcpConfigKey: null,
    mcpConfigFormat: "json",
  })),
};

export const CATALOG: DiscoverCatalog = {
  sources: [
    {
      id: "src-1",
      repoUrl: "https://github.com/anthropics/skills",
      refName: "",
      subpath: "",
      addedAt: "2026-09-27T12:00:00Z",
      stars: 4821,
      starsFetchedAt: "2026-09-27T12:00:00Z",
    },
  ],
  entries: [
    ["mcp-builder", "Builds an MCP server from a description, with the schema and the tests."],
    ["canvas-design", "Designs on a canvas — layout, type and colour that hold together."],
    ["webapp-testing", "Drives a web application and reports what actually broke."],
    ["docx", "Reading and writing Word documents without losing the formatting."],
    ["pptx", "Slide decks: building them, and editing the ones you were sent."],
    [
      "frontend-design",
      "Interface work that reads as one system rather than a pile of components.",
    ],
  ].map(([name, description], index) => ({
    id: `entry-${index}`,
    sourceId: "src-1",
    repoUrl: "https://github.com/anthropics/skills",
    refName: "",
    subpath: `skills/${name}`,
    type: "skill" as const,
    name: name as string,
    description: description as string,
    tags: [],
    commit: "33375500bcea98d610eb30ce10ac4e59b89c390d",
    manifest: "---\n---\n",
    discoveredAt: "2026-09-27T12:00:00Z",
  })),
};

/** What a search of the registry comes back with. */
export const REGISTRY_HITS: RegistryHit[] = (
  [
    ["anthropics/skills", "pdf", 201_991],
    ["anthropics/skills", "xlsx", 154_220],
    ["anthropics/skills", "docx", 141_006],
    ["anthropics/skills", "pptx", 98_430],
    ["obra/superpowers", "document-review", 44_118],
    ["obra/superpowers", "pdf-forms", 21_775],
    ["vercel-labs/agent-skills", "pdf-extract", 12_904],
    ["kepano/obsidian-skills", "pdf-annotate", 3_112],
  ] as Array<[string, string, number]>
).map(([source, name, installs]) => ({
  id: `${source}/${name}`,
  source,
  name,
  installs,
  repoUrl: `https://github.com/${source}`,
}));

export const REVIEW: ReviewHandle = {
  reviewId: "rev-demo",
  entryId: ITEMS[6]?.entryId ?? "",
  stats: { added: 6, removed: 3 },
  commit: "9d41c0e5a7b2f3814ce6d0a9b7f25c1e380a6b4d",
  unchanged: false,
  companions: [
    { path: "references/sources.md", status: "modified" },
    { path: "scripts/collect.py", status: "added" },
    { path: "references/old-notes.md", status: "removed" },
  ],
  lines: [
    { marker: " ", number: 3, segments: [{ text: "name: deep-research", emphasis: false }] },
    {
      marker: "-",
      number: 4,
      segments: [
        { text: "description: Long-running research across ", emphasis: false },
        { text: "many", emphasis: true },
        { text: " sources.", emphasis: false },
      ],
    },
    {
      marker: "+",
      number: 4,
      segments: [
        { text: "description: Long-running research across ", emphasis: false },
        { text: "the web and your own notes", emphasis: true },
        { text: " sources.", emphasis: false },
      ],
    },
    { marker: " ", number: 5, segments: [{ text: "---", emphasis: false }] },
    { marker: " ", number: 6, segments: [{ text: "", emphasis: false }] },
    { marker: " ", number: 7, segments: [{ text: "## When to use this", emphasis: false }] },
    { marker: " ", number: 8, segments: [{ text: "", emphasis: false }] },
    {
      marker: "-",
      number: 9,
      segments: [
        { text: "Reach for it when a question needs more than one search.", emphasis: true },
      ],
    },
    {
      marker: "+",
      number: 9,
      segments: [
        { text: "Reach for it when a question needs more than one source, and", emphasis: true },
      ],
    },
    {
      marker: "+",
      number: 10,
      segments: [{ text: "when the sources will disagree with each other.", emphasis: true }],
    },
    { marker: " ", number: 11, segments: [{ text: "", emphasis: false }] },
    { marker: " ", number: 12, segments: [{ text: "## How it works", emphasis: false }] },
    {
      marker: "+",
      number: 13,
      segments: [{ text: "", emphasis: false }],
    },
    {
      marker: "+",
      number: 14,
      segments: [
        { text: "Findings are written up as they arrive, not at the end.", emphasis: true },
      ],
    },
  ],
};

/**
 * What a tool's history would say, for the screens that show usage.
 *
 * A handful of items only: a real history has run a few things often and most
 * things never, which is the point the dashboard is making.
 */
export const USAGE: Record<string, UsageStats> = Object.fromEntries(
  (
    [
      ["graphify", 34, "2026-09-27T16:20:00Z"],
      ["pdf", 21, "2026-09-26T09:05:00Z"],
      ["deep-research", 12, "2026-09-24T11:40:00Z"],
      ["sap-abap-cds", 9, "2026-09-22T08:15:00Z"],
      ["review", 6, "2026-09-19T17:30:00Z"],
      ["obsidian", 3, "2026-09-12T20:05:00Z"],
    ] as const
  ).flatMap(([name, count, lastUsed]) => {
    const item = ITEMS.find((candidate) => candidate.name === name);
    return item ? [[item.entryId, { count, lastUsed }] as const] : [];
  }),
);

export const DASHBOARD: DashboardReport = {
  // Sorted the way the Rust report sorts it, so "Ranked by cost" is one.
  costs: ITEMS.filter((item) => item.enabled)
    .map((item, index) => {
      const chars = SEEDS[index]?.chars ?? 4_000;
      const modelled = item.type === "skill" || item.type === "agent";
      return {
        entryId: item.entryId,
        name: item.name,
        tool: item.tool,
        type: item.type,
        sourceChars: chars,
        availableChars: modelled ? item.name.length + item.description.length + 1 : null,
        invocationChars: modelled ? Math.round(chars * 0.94) : null,
        modified: item.modified,
      };
    })
    .sort((a, b) => b.sourceChars - a.sourceChars),
  prune: [
    {
      entryId: ITEMS[5]?.entryId ?? "",
      name: "abap-repo-assessment",
      tool: "claude-code",
      reason: "never-used",
      sourceChars: 28_600,
      lastUsed: null,
      modified: "2026-02-14T10:00:00Z",
    },
    {
      entryId: ITEMS[18]?.entryId ?? "",
      name: "openai-docs",
      tool: "codex",
      reason: "not-used-lately",
      sourceChars: 24_900,
      lastUsed: "2026-06-02T14:11:00Z",
      modified: "2026-06-02T14:11:00Z",
    },
    {
      entryId: ITEMS[2]?.entryId ?? "",
      name: "sap-fiori-tools",
      tool: "claude-code",
      reason: "large-and-old",
      sourceChars: 22_400,
      lastUsed: null,
      modified: "2025-11-03T08:00:00Z",
    },
  ],
  overlaps: [
    {
      a: ITEMS[12]?.entryId ?? "",
      b: ITEMS[19]?.entryId ?? "",
      aName: "review",
      bName: "review-agent",
      pairId: "pair-1",
      reason: "similar-description",
      similarity: 0.62,
    },
  ],
  totalSourceChars: 0,
  totalAvailableChars: 0,
  totalInvocationChars: 0,
};

DASHBOARD.totalSourceChars = DASHBOARD.costs.reduce((sum, c) => sum + c.sourceChars, 0);
DASHBOARD.totalAvailableChars = DASHBOARD.costs.reduce(
  (sum, c) => sum + (c.availableChars ?? 0),
  0,
);
DASHBOARD.totalInvocationChars = DASHBOARD.costs.reduce(
  (sum, c) => sum + (c.invocationChars ?? 0),
  0,
);

export const MCP_SERVERS: McpServer[] = [
  {
    id: "claude-code:global:obsidian",
    name: "obsidian",
    tool: "claude-code",
    projectId: null,
    config: {
      command: "npx",
      args: ["-y", "obsidian-mcp", "/Users/you/Vault"],
      env: { OBSIDIAN_API_KEY: "8f3c1d9a77b24e0c" },
      url: null,
      type: null,
    },
    sourcePath: "/Users/you/.claude.json",
  },
  {
    id: "codex:global:github",
    name: "github",
    tool: "codex",
    projectId: null,
    config: {
      command: "gh-mcp",
      args: ["--stdio"],
      env: { GITHUB_TOKEN: "ghp_x9Ke2Lm4Qw" },
      url: null,
      type: null,
    },
    sourcePath: "/Users/you/.codex/config.toml",
  },
  {
    id: "codex:global:cds_mcp",
    name: "cds_mcp",
    tool: "codex",
    projectId: null,
    config: { command: "cds-mcp", args: [], env: {}, url: null, type: null },
    sourcePath: "/Users/you/.codex/config.toml",
  },
  {
    id: "claude-code:global:docs",
    name: "docs",
    tool: "claude-code",
    projectId: null,
    config: {
      command: null,
      args: [],
      env: {},
      url: "https://docs.example.com/mcp",
      type: "http",
    },
    sourcePath: "/Users/you/.claude.json",
  },
];

export const TOOL_REPORTS: ToolReport[] = [
  ["claude-code", true],
  ["codex", true],
  ["cursor", true],
  ["opencode", true],
  ["global", true],
  ["windsurf", false],
  ["goose", false],
].map(([id, detected]) => {
  const tool = {
    id: id as string,
    paths: {
      skill: `~/.${id}/skills`,
      agent: `~/.${id}/agents`,
      command: `~/.${id}/commands`,
    },
    projectPaths: {},
    unconfirmedPaths: {},
    disabled: false,
    custom: false,
    singleFileRule: false,
    ruleAdditionalPaths: [],
    ruleAdditionalProjectPaths: [],
    builtInDirnames: [],
    pluginsRegistry: null,
    pluginsPaths: [],
    pluginsSettingsPath: null,
    pluginPaths: {},
    mcpConfigPath: null,
    projectMcpConfigPath: null,
    mcpConfigKey: null,
    mcpConfigFormat: "json" as const,
  };
  return {
    tool,
    shipped: tool,
    overrides: { paths: {}, projectPaths: {} },
    detected: detected as boolean,
    paths: [],
  };
});

const FRONTMATTER = `---
name: sap-abap-cds
description: Core Data Services for ABAP…
license: MIT
---
`;

/** The file behind the item the library screenshot has open. */
export const ITEM_CONTENT = {
  // Set below from the body: the token estimate is computed from this, so an
  // empty placeholder would put "~0 tokens" in every screenshot.
  raw: "",
  frontmatter: [
    { key: "name", value: "sap-abap-cds" },
    { key: "description", value: "Core Data Services for ABAP…" },
    { key: "license", value: "MIT" },
  ],
  body: `
## When to use this

Reach for it when you are defining a data model in ABAP — view entities,
associations, annotations — or when a CDS error message has stopped making
sense.

### A view entity

\`\`\`abap
@AccessControl.authorizationCheck: #CHECK
define view entity ZI_Booking
  as select from /dmo/booking as Booking
  association [1..1] to ZI_Travel as _Travel
    on $projection.TravelUUID = _Travel.TravelUUID
{
  key booking_uuid   as BookingUUID,
      travel_uuid    as TravelUUID,
      booking_date   as BookingDate,
      @Semantics.amount.currencyCode: 'CurrencyCode'
      flight_price   as FlightPrice,
      currency_code  as CurrencyCode,
      _Travel
}
\`\`\`

### Reference fields

A \`CURR\` or \`QUAN\` field needs its reference field in the same view, and
annotated. Leaving it out is the single most common reason a view activates
and then returns nothing usable.

| Type | Annotation | Reference |
|---|---|---|
| \`CURR\` | \`@Semantics.amount.currencyCode\` | the currency field |
| \`QUAN\` | \`@Semantics.quantity.unitOfMeasure\` | the unit field |
`,
  bytes: 41_200,
  modified: "2026-09-12T09:20:00Z",
  isSymlink: true,
  realPath: "/Users/you/.agents/skills/sap-abap-cds/SKILL.md",
  // Of a piece with the manifest above, so the panel does not show a 1 KB
  // file with 40 KB of references hanging off it.
  siblingFiles: [
    { path: "references/annotations.md", bytes: 3_100 },
    { path: "references/dcl.md", bytes: 1_800 },
    { path: "references/functions.md", bytes: 2_400 },
    { path: "scripts/validate.py", bytes: 940 },
  ],
};

ITEM_CONTENT.raw = FRONTMATTER + ITEM_CONTENT.body;
ITEM_CONTENT.bytes = ITEM_CONTENT.raw.length;
