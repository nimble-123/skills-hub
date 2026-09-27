import type { ItemMetadata, LibrarySnapshot, SettingsView } from "../bindings";

export function anItem(overrides: Partial<ItemMetadata> = {}): ItemMetadata {
  const name = overrides.name ?? "writing";
  return {
    entryId: `${name}-abc123`,
    sourcePath: `/home/.claude/skills/${name}/SKILL.md`,
    realPath: `/home/.claude/skills/${name}/SKILL.md`,
    tool: "claude-code",
    type: "skill",
    projectId: null,
    pluginId: null,
    name,
    description: `${name} does something useful`,
    enabled: true,
    modified: "2026-01-01T00:00:00Z",
    tags: [],
    favorite: false,
    collections: [],
    sourceRepo: null,
    sourceRef: null,
    sourceSubpath: null,
    sourceCommit: null,
    ...overrides,
  };
}

export function aSnapshot(items: ItemMetadata[]): LibrarySnapshot {
  return {
    items,
    plugins: [],
    brokenSymlinks: [],
    warnings: [],
    scannedAt: "2026-09-27T12:00:00Z",
    version: 1,
    orphanCount: 0,
  };
}

export function aSettingsView(): SettingsView {
  return {
    settings: {
      schemaVersion: 1,
      metadataFolder: "/home/vault/AI Skills Manager",
      toolOverrides: {},
      customTools: [],
      projectWorkspaces: [],
      collections: [],
      sectionOrder: ["types", "extensions", "tools", "projects", "collections"],
      showEmptySidebarRows: false,
      defaultSortOrder: "name-asc",
      defaultEnabledFilter: "all",
      theme: "system",
    },
    tools: [
      {
        id: "claude-code",
        paths: { skill: "~/.claude/skills" },
        projectPaths: {},
        unconfirmedPaths: {},
        disabled: false,
        custom: false,
        singleFileRule: true,
        ruleAdditionalPaths: [],
        ruleAdditionalProjectPaths: [],
        builtInDirnames: ["synced"],
        pluginsRegistry: null,
        pluginsPaths: [],
        pluginsSettingsPath: null,
        pluginPaths: {},
        mcpConfigPath: null,
        projectMcpConfigPath: null,
        mcpConfigKey: null,
        mcpConfigFormat: "json",
      },
    ],
  };
}
