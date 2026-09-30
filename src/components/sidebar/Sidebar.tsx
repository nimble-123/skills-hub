import { open } from "@tauri-apps/plugin-dialog";
import { commands } from "../../bindings";
import type { Facets } from "../../lib/library";
import { GLOBAL } from "../../lib/library";
import { reportError } from "../../stores/errors";
import { useFilters } from "../../stores/filters";
import { useLibrary } from "../../stores/library";
import { useCollections, usePlugins, useWorkspaces } from "../../stores/selectors";
import { useSettings } from "../../stores/settings";
import { useUi } from "../../stores/ui";
import { TOOL_META, TYPE_META } from "../../toolMeta";
import { Icon, ToolIcon } from "../common/Icon";
import { BuildStamp } from "./BuildStamp";
import { NavRow } from "./NavRow";
import { Section } from "./Section";
import styles from "./Sidebar.module.css";

type SidebarProps = {
  facets: Facets;
};

export function Sidebar({ facets }: SidebarProps) {
  const { scope, setScope } = useFilters();
  const { route, go } = useUi();
  const settings = useSettings((store) => store.settings);
  const tools = useSettings((store) => store.tools);
  const snapshot = useLibrary((store) => store.snapshot);
  const state = useLibrary((store) => store.state);
  const rescan = useLibrary((store) => store.rescan);
  const progress = useLibrary((store) => store.progress);

  const addProjectWorkspace = useSettings((store) => store.addProjectWorkspace);
  const removeProjectWorkspace = useSettings((store) => store.removeProjectWorkspace);
  const loadSettings = useSettings((store) => store.load);
  const collections = useCollections();
  const workspaces = useWorkspaces();
  const plugins = usePlugins();
  const showEmpty = settings?.showEmptySidebarRows ?? false;

  /** Deleting a collection takes it out of every item that was in it. */
  const removeCollection = async (id: string) => {
    const result = await commands.deleteCollection(id);
    if (result.status === "error") reportError(result.error);
    else await loadSettings();
  };

  /** Removing one only means it stops being scanned; nothing on disk changes. */
  const removeWorkspace = async (id: string) => {
    await removeProjectWorkspace(id);
    await rescan();
  };

  /** Adding a workspace only matters once it has been scanned. */
  const addWorkspace = async () => {
    const folder = await open({
      directory: true,
      multiple: false,
      title: "Which project folder should be scanned?",
    });
    if (typeof folder !== "string") return;
    if (await addProjectWorkspace(folder)) await rescan();
  };
  const inLibrary = route.kind === "library";
  const attention = (snapshot?.brokenSymlinks.length ?? 0) + (snapshot?.orphanCount ?? 0);

  /** Jumping to a scope always means going back to the library. */
  const pick = (next: Parameters<typeof setScope>[0]) => {
    setScope(next);
    go({ kind: "library" });
  };

  return (
    <nav className={styles.sidebar} aria-label="Library">
      <div className={styles.brand}>
        <span className={styles.brandMark}>
          <Icon name="shapes" size={18} />
        </span>
        skills-hub
      </div>

      <div className={styles.scroll}>
        <NavRow
          icon={<Icon name="library" />}
          label="All"
          count={facets.all}
          active={inLibrary && scope.kind === "all"}
          onClick={() => pick({ kind: "all" })}
        />
        <NavRow
          icon={<Icon name="compass" />}
          label="Discover"
          active={route.kind === "discover"}
          onClick={() => go({ kind: "discover" })}
        />
        <NavRow
          icon={<Icon name="gauge" />}
          label="Cost"
          active={route.kind === "dashboard"}
          onClick={() => go({ kind: "dashboard" })}
        />
        <NavRow
          icon={<Icon name="star" />}
          label="Favourites"
          count={facets.favourites}
          active={inLibrary && scope.kind === "favourites"}
          onClick={() => pick({ kind: "favourites" })}
        />

        <Section name="types" label="Types">
          {Object.entries(TYPE_META).map(([type, meta]) => {
            const count = facets.byType.get(type as keyof typeof TYPE_META) ?? 0;
            if (count === 0 && !showEmpty) return null;
            return (
              <NavRow
                key={type}
                icon={<Icon name={meta.icon} />}
                type={type as keyof typeof TYPE_META}
                label={meta.plural}
                count={count}
                active={inLibrary && scope.kind === "type" && scope.type === type}
                onClick={() => pick({ kind: "type", type: type as keyof typeof TYPE_META })}
              />
            );
          })}
        </Section>

        <Section name="tools" label="Tools">
          <NavRow
            icon={<Icon name="wrench" />}
            label="All tools"
            active={route.kind === "tools"}
            onClick={() => go({ kind: "tools" })}
          />
          {tools.map((tool) => {
            const count = facets.byTool.get(tool.id) ?? 0;
            if (count === 0 && !showEmpty) return null;
            return (
              <NavRow
                key={tool.id}
                icon={<ToolIcon toolId={tool.id} />}
                label={TOOL_META[tool.id]?.label ?? tool.id}
                count={count}
                active={inLibrary && scope.kind === "tool" && scope.toolId === tool.id}
                onClick={() => pick({ kind: "tool", toolId: tool.id })}
              />
            );
          })}
        </Section>

        <Section
          name="projects"
          label="Workspaces"
          action={{
            icon: "folder-plus",
            label: "Add a project folder",
            onClick: () => void addWorkspace(),
          }}
        >
          <NavRow
            icon={<Icon name="house" />}
            label="Global"
            count={facets.byProject.get(GLOBAL) ?? 0}
            title="Skills in your home directory, shared across every project"
            active={inLibrary && scope.kind === "project" && scope.projectId === null}
            onClick={() => pick({ kind: "project", projectId: null })}
          />
          {workspaces.map((project) => (
            <NavRow
              key={project.id}
              icon={<Icon name="folder-git-2" />}
              label={project.name}
              count={facets.byProject.get(project.id) ?? 0}
              title={project.path}
              active={inLibrary && scope.kind === "project" && scope.projectId === project.id}
              onClick={() => pick({ kind: "project", projectId: project.id })}
              onRemove={{
                label: `Stop scanning ${project.name}`,
                onClick: () => void removeWorkspace(project.id),
              }}
            />
          ))}
        </Section>

        <Section name="extensions" label="Extensions">
          <NavRow
            icon={<Icon name="plug" />}
            label="MCP servers"
            active={route.kind === "mcp"}
            onClick={() => go({ kind: "mcp" })}
          />
        </Section>

        {collections.length > 0 && (
          <Section name="collections" label="Collections">
            {collections.map((collection) => (
              <NavRow
                key={collection.id}
                icon={<Icon name="folder" />}
                label={collection.name}
                count={facets.byCollection.get(collection.id) ?? 0}
                active={
                  inLibrary && scope.kind === "collection" && scope.collectionId === collection.id
                }
                onClick={() => pick({ kind: "collection", collectionId: collection.id })}
                onRemove={{
                  label: `Delete the collection ${collection.name}`,
                  onClick: () => void removeCollection(collection.id),
                }}
              />
            ))}
          </Section>
        )}

        {facets.byPlugin.size > 0 && (
          <Section name="plugins" label="Plugin bundles">
            {plugins
              .filter((plugin) => showEmpty || (facets.byPlugin.get(plugin.id) ?? 0) > 0)
              .map((plugin) => (
                <NavRow
                  key={plugin.id}
                  icon={<Icon name="package" />}
                  label={plugin.name}
                  count={facets.byPlugin.get(plugin.id) ?? 0}
                  title={plugin.group ? `${plugin.name} · ${plugin.group}` : plugin.name}
                  active={inLibrary && scope.kind === "plugin" && scope.pluginId === plugin.id}
                  onClick={() => pick({ kind: "plugin", pluginId: plugin.id })}
                />
              ))}
          </Section>
        )}

        {attention > 0 && (
          <Section name="attention" label="Needs a look">
            <NavRow
              icon={<Icon name="unlink" />}
              label="Broken links & orphans"
              count={attention}
              attention
              active={route.kind === "orphans"}
              onClick={() => go({ kind: "orphans" })}
            />
          </Section>
        )}
      </div>

      {progress && <div className={styles.progress}>{describe(progress)}</div>}

      <div className={styles.footer}>
        <NavRow
          icon={
            <Icon
              name="refresh-cw"
              className={state === "scanning" ? styles.spinning : undefined}
            />
          }
          label={state === "scanning" ? "Scanning…" : "Rescan"}
          onClick={() => void rescan()}
        />
        <NavRow
          icon={<Icon name="settings" />}
          label="Settings"
          active={route.kind === "settings"}
          onClick={() => go({ kind: "settings" })}
        />
        <BuildStamp />
      </div>
    </nav>
  );
}

function describe(progress: NonNullable<ReturnType<typeof useLibrary.getState>["progress"]>) {
  switch (progress.stage) {
    case "scanning":
      return `Scanning ${progress.source} (${progress.done}/${progress.total})`;
    case "recording":
      return `Recording ${progress.done}/${progress.total}`;
    case "finished":
      return "Done";
  }
}
