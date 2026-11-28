"use client";

/**
 * FileDropzone — adapted from the 21st.dev "File Dropzone" component by amankaushik481
 * (https://21st.dev/@amankaushik481/components/file-dropzone).
 * Kept: click / Enter / Space to browse, accept & reject drag states, SVG hairline dashed border that marches
 * while dragging, lifting icon tile, polite screen-reader announcement.
 * Changed: zone only (Overbill keeps its own file list and validation), mapped to this project's shadcn tokens,
 * and every file is handed to `onFiles` so the app's own validators can explain a rejection.
 */

import * as React from "react";
import { ArrowUpIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

function matches(accept: string | undefined, type: string, name = "") {
  if (!accept) return true;
  return accept.split(",").some((raw) => {
    const a = raw.trim().toLowerCase();
    if (!a) return false;
    if (a.startsWith(".")) return name.toLowerCase().endsWith(a);
    if (a.endsWith("/*")) return type.toLowerCase().startsWith(a.slice(0, -1));
    return type.toLowerCase() === a;
  });
}

export interface FileDropzoneProps {
  onFiles: (files: File[]) => void;
  /** Same syntax as <input accept>. Used for the picker filter and the drag-over accept/reject hint. */
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  label?: string;
  hint?: string;
  inputLabel?: string;
  className?: string;
}

export function FileDropzone({ onFiles, accept, multiple = true, disabled, label = "Drop files to upload", hint, inputLabel = "Choose files", className }: FileDropzoneProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const depth = React.useRef(0);
  const [drag, setDrag] = React.useState<"idle" | "accept" | "reject">("idle");
  const [announce, setAnnounce] = React.useState("");
  const id = React.useId();

  const add = (list: FileList | File[]) => {
    const files = Array.from(list);
    if (!files.length) return;
    setAnnounce(`${files.length} file${files.length > 1 ? "s" : ""} added`);
    onFiles(files);
  };
  const open = () => !disabled && inputRef.current?.click();

  const dragKind = (e: React.DragEvent): "accept" | "reject" => {
    const items = Array.from(e.dataTransfer.items ?? []).filter((i) => i.kind === "file");
    if (!items.length) return "accept";
    if (!multiple && items.length > 1) return "reject";
    // Drag items expose a MIME type but no file name, so an extension-only `accept` (".pdf,.csv") cannot be judged here; the drop is validated afterwards.
    const mimeRules = (accept ?? "").split(",").some((a) => a.trim().includes("/"));
    // An extension rule next to MIME rules (".csv,application/pdf") can match a file the drag cannot show a name for, so an unmatched type stays undecided until drop.
    const extensionRules = (accept ?? "").split(",").some((a) => a.trim().startsWith("."));
    return !mimeRules || extensionRules || items.every((i) => !i.type || matches(accept, i.type)) ? "accept" : "reject";
  };

  const over = drag !== "idle";
  const reject = drag === "reject";

  return (
    <div data-slot="file-dropzone" className={cn("w-full", className)}>
      <input id={id} ref={inputRef} type="file" className="sr-only" tabIndex={-1} aria-label={inputLabel} accept={accept} multiple={multiple} disabled={disabled}
        onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ""; }} />
      <label
        htmlFor={id} role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled || undefined} aria-describedby={`${id}-hint`} data-drag={drag}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }}
        onDragEnter={(e) => { e.preventDefault(); if (disabled) return; depth.current += 1; setDrag(dragKind(e)); }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = disabled ? "none" : "copy"; /* rejected files still need to reach onFiles so the app can say why */ }}
        onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (depth.current === 0) setDrag("idle"); }}
        onDrop={(e) => { e.preventDefault(); depth.current = 0; setDrag("idle"); if (!disabled && e.dataTransfer.files?.length) add(e.dataTransfer.files); }}
        className={cn(
          "group/drop relative isolate flex w-full cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-xl bg-card px-6 py-12 text-center outline-none transition-colors duration-150",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          !over && "hover:bg-muted/60",
          over && !reject && "bg-accent",
          reject && "bg-bad-bg",
          disabled && "pointer-events-none opacity-50",
        )}
      >
        {/* Hairline dashed border: crisp at any size, marches while dragging. */}
        <svg aria-hidden className="pointer-events-none absolute inset-[0.5px] size-[calc(100%-1px)] overflow-visible">
          <rect width="100%" height="100%" rx="11.5" fill="none" strokeWidth="1" strokeDasharray="6 5"
            className={cn("transition-[stroke] duration-150", reject ? "stroke-bad" : over ? "stroke-primary" : "stroke-input group-hover/drop:stroke-muted-foreground", over && !reject && "animate-[dash-march_0.6s_linear_infinite]")} />
        </svg>
        <span className={cn("grid size-11 place-items-center rounded-xl border shadow-xs transition-[transform,background-color,border-color,color] duration-200",
          reject ? "border-bad-line bg-card text-bad" : over ? "-translate-y-1 border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground group-hover/drop:-translate-y-0.5 group-hover/drop:text-foreground")}>
          {reject ? <XIcon className="size-4" /> : <ArrowUpIcon className="size-4" />}
        </span>
        <div className="space-y-1">
          <p className="text-base font-semibold tracking-tight">{reject ? "That file type won't work" : over ? "Release to add" : label}</p>
          <p id={`${id}-hint`} className="text-sm text-muted-foreground">
            {reject ? "Try PDF, image or CSV files." : <><span className="font-medium text-foreground underline decoration-input underline-offset-[3px] group-hover/drop:decoration-muted-foreground">Browse</span><span className="pointer-coarse:hidden"> or drag here</span>{hint ? ` · ${hint}` : ""}</>}
          </p>
        </div>
      </label>
      <span className="sr-only" aria-live="polite">{announce}</span>
    </div>
  );
}
