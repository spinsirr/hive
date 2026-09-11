import {
  Atom, Braces, Database, File, FileArchive, FileCode2, FileImage,
  FileJson2, FileLock2, FileText, Folder, FolderOpen, Link2, Package,
  Settings2, SquareTerminal, type LucideIcon,
} from "lucide-react";

import { workspaceFileType, type WorkspaceFileType } from "@/lib/workspace-file-type";
import type { WorkspaceEntry } from "@/lib/workspace-files";

type Appearance = { icon: LucideIcon; color: string; badge?: string };

const fileIcons: Record<WorkspaceFileType, Appearance> = {
  typescript: { icon: FileCode2, color: "bg-[#3178c6] text-white", badge: "TS" },
  javascript: { icon: FileCode2, color: "bg-[#efd345] text-[#292929]", badge: "JS" },
  react: { icon: Atom, color: "text-[#087f98]" },
  json: { icon: FileJson2, color: "text-[#a86c13]" },
  markdown: { icon: FileText, color: "text-[#3973ad]" },
  stylesheet: { icon: Braces, color: "text-[#8250b5]" },
  config: { icon: Settings2, color: "text-[#737373]" },
  package: { icon: Package, color: "text-[#45815a]" },
  shell: { icon: SquareTerminal, color: "text-[#45815a]" },
  image: { icon: FileImage, color: "text-[#9a60ad]" },
  archive: { icon: FileArchive, color: "text-[#916746]" },
  database: { icon: Database, color: "text-[#427fa2]" },
  code: { icon: FileCode2, color: "text-[#537789]" },
  file: { icon: File, color: "text-[#8a8a8a]" },
};

export function WorkspaceFileIcon({ path, kind = "file", expanded = false }: {
  path: string;
  kind?: WorkspaceEntry["kind"];
  expanded?: boolean;
}) {
  const appearance: Appearance = kind === "directory"
    ? { icon: expanded ? FolderOpen : Folder, color: "text-[#a37c26]" }
    : kind === "restricted"
      ? { icon: FileLock2, color: "text-[#737373]" }
      : kind === "symlink"
        ? { icon: Link2, color: "text-[#737373]" }
        : fileIcons[kind === "file" ? workspaceFileType(path) : "file"];
  const Icon = appearance.icon;

  // The adjacent filename already names the item. Decorative icons must not
  // change button labels, keyboard navigation, or the restricted-file state.
  // Only these 16px decorative icons use lettering below the 12px UI text floor.
  return (
    <span aria-hidden="true" className={`inline-flex size-4 shrink-0 items-center justify-center rounded-[2px] ${appearance.color}`}>
      {appearance.badge
        ? <span className="text-[10px] font-semibold leading-none tracking-[-0.06em]">{appearance.badge}</span>
        : <Icon className="size-4" strokeWidth={1.7} />}
    </span>
  );
}
