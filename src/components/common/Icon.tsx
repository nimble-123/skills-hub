import type { CSSProperties } from "react";
import { TOOL_META } from "../../toolMeta";
import { ICONS } from "./icons";

type IconProps = {
  /** A Lucide icon name, in kebab case. */
  name: string;
  size?: number | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
};

/**
 * A Lucide icon, looked up by name in the bundled registry.
 *
 * Names are strings because that is how the tool registry and the item types
 * refer to them. They resolve against `icons.ts` rather than against the whole
 * of `lucide-react`, which would put every icon in the bundle. An unknown name
 * draws nothing; `icons.test.ts` makes sure there are none.
 */
export function Icon({ name, size = 16, className, style }: IconProps) {
  const Component = ICONS[name];
  if (!Component) return null;
  return <Component size={size} className={className} style={style} aria-hidden />;
}

type ToolIconProps = {
  toolId: string;
  size?: number | undefined;
  className?: string | undefined;
};

/**
 * A tool's brand mark, or its Lucide fallback.
 *
 * The marks are forced to `currentColor` so they follow the theme like every
 * other icon; `toolMeta.test.ts` checks that none of them hard-codes a colour.
 */
export function ToolIcon({ toolId, size = 16, className }: ToolIconProps) {
  const meta = TOOL_META[toolId];
  if (!meta) return <Icon name="box" size={size} className={className} />;
  if (!meta.svg) return <Icon name={meta.icon} size={size} className={className} />;

  return (
    <span
      className={className}
      style={{ width: size, height: size, display: "inline-flex" }}
      aria-hidden
      // The marks are ours, shipped in toolMeta.ts, not anything a scan read
      // off disk.
      // biome-ignore lint/security/noDangerouslySetInnerHtml: bundled assets
      dangerouslySetInnerHTML={{ __html: sized(meta.svg, size) }}
    />
  );
}

function sized(svg: string, size: number): string {
  return svg.replace("<svg", `<svg width="${size}" height="${size}"`);
}
