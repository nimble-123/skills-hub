import { useMemo } from "react";
import type { ItemMetadata } from "../../bindings";
import type { Facets, Scope } from "../../lib/library";
import { useFilters } from "../../stores/filters";
import { useSettings } from "../../stores/settings";
import { useUi } from "../../stores/ui";
import { TOOL_META, TYPE_META } from "../../toolMeta";
import gridStyles from "../grid/Grid.module.css";
import { ItemGrid } from "../grid/ItemGrid";
import { Toolbar } from "../grid/Toolbar";

type LibraryPaneProps = {
  visible: ItemMetadata[];
  facets: Facets;
  searchRef: React.RefObject<HTMLInputElement | null>;
  /** How many cards fit across, so arrow keys know what "up" means. */
  onColumnsChange: (columns: number) => void;
};

export function LibraryPane({ visible, facets, searchRef, onColumnsChange }: LibraryPaneProps) {
  const scope = useFilters((f) => f.scope);
  const selected = useUi((ui) => ui.selected);
  const select = useUi((ui) => ui.select);
  const workspaces = useSettings((store) => store.settings?.projectWorkspaces);

  const projectNames = useMemo(
    () => new Map((workspaces ?? []).map((project) => [project.id, project.name])),
    [workspaces],
  );
  const title = useMemo(() => scopeTitle(scope, projectNames), [scope, projectNames]);

  return (
    <div className={gridStyles.pane}>
      <div className={gridStyles.header}>
        <h1 className={gridStyles.title}>
          {title.heading}
          <span className={gridStyles.pill}>{visible.length}</span>
        </h1>
        <p className={gridStyles.subtitle}>{title.subtitle}</p>
      </div>

      <Toolbar facets={facets} searchRef={searchRef} />

      <ItemGrid
        items={visible}
        selected={selected}
        projectNames={projectNames}
        onColumnsChange={onColumnsChange}
        onSelect={(entryId) => select(entryId === selected ? null : entryId)}
      />
    </div>
  );
}

function scopeTitle(
  scope: Scope,
  projectNames: Map<string, string>,
): { heading: string; subtitle: string } {
  switch (scope.kind) {
    case "all":
      return {
        heading: "Everything",
        subtitle: "Every skill, agent, command and rule found across your tools.",
      };
    case "favourites":
      return { heading: "Favourites", subtitle: "The ones you starred." };
    case "type":
      return {
        heading: TYPE_META[scope.type].plural,
        subtitle: `Every ${TYPE_META[scope.type].label.toLowerCase()}, across every tool.`,
      };
    case "tool": {
      const label = TOOL_META[scope.toolId]?.label ?? scope.toolId;
      return { heading: label, subtitle: `Everything ${label} reads.` };
    }
    case "project":
      return scope.projectId === null
        ? {
            heading: "Global",
            subtitle: "Items in your home directory, available to every project.",
          }
        : {
            heading: projectNames.get(scope.projectId) ?? "Workspace",
            subtitle: "Items that live inside this project folder.",
          };
    case "plugin":
      return {
        heading: scope.pluginId.split("@")[0] ?? scope.pluginId,
        subtitle: "Shipped inside an installed plugin, and managed by its own tool.",
      };
    case "collection":
      return { heading: "Collection", subtitle: "Items you grouped together." };
  }
}
