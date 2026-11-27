"use client";

/**
 * Sidebar — adapted from the 21st.dev "Sidebar" component by wensity
 * (https://21st.dev/@wensity/components/sidebar).
 * Kept: compound API, collapse-to-icon-rail, gliding active pill (Framer Motion layoutId),
 * fading labels, reduced-motion gating. Trimmed: floating / resizable / nested variants (unused here).
 * Changed: Tabler icons -> lucide, items render a Next <Link> through `asChild`.
 */

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useRender } from "@base-ui/react/use-render";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";

const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];

type SidebarContextValue = { collapsed: boolean; toggleCollapsed: () => void; navId: string };
const SidebarContext = React.createContext<SidebarContextValue | null>(null);

function useSidebarContext() {
  const ctx = React.useContext(SidebarContext);
  if (!ctx) throw new Error("Sidebar compound components must be used within <Sidebar>");
  return ctx;
}

/** Real collapsed state, for custom header/footer content. */
export function useSidebar() {
  const { collapsed, toggleCollapsed } = useSidebarContext();
  return { collapsed, toggleCollapsed };
}

export interface SidebarProps extends React.HTMLAttributes<HTMLElement> {
  collapsed?: boolean;
  defaultCollapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Width in px when expanded. */
  width?: number;
  /** Width in px when collapsed. */
  collapsedWidth?: number;
  /** Disable collapsing (e.g. inside a mobile sheet). */
  fixed?: boolean;
  "aria-label"?: string;
}

export function Sidebar({
  collapsed: controlled, defaultCollapsed = false, onCollapsedChange, width = 248, collapsedWidth = 64, fixed = false,
  className, children, "aria-label": ariaLabel = "Sidebar", style, ...props
}: SidebarProps) {
  const reactId = React.useId();
  const reduce = useReducedMotion();
  const [internal, setInternal] = React.useState(defaultCollapsed);
  const isControlled = controlled !== undefined;
  const collapsed = fixed ? false : isControlled ? controlled : internal;

  const toggleCollapsed = React.useCallback(() => {
    if (fixed) return;
    const next = !collapsed;
    if (!isControlled) setInternal(next);
    onCollapsedChange?.(next);
  }, [fixed, collapsed, isControlled, onCollapsedChange]);

  const ctx = React.useMemo(() => ({ collapsed, toggleCollapsed, navId: `sidebar-${reactId}` }), [collapsed, toggleCollapsed, reactId]);

  return (
    <SidebarContext.Provider value={ctx}>
      <aside
        aria-label={ariaLabel}
        data-slot="sidebar"
        data-collapsed={collapsed ? "true" : "false"}
        style={{ ...style, width: collapsed ? collapsedWidth : width, flexShrink: 0, transition: reduce ? "none" : "width 240ms cubic-bezier(0.23,1,0.32,1)" }}
        className={cn("relative isolate flex h-full flex-col overflow-hidden border-r bg-sidebar text-sidebar-foreground", className)}
        {...props}
      >
        {children}
      </aside>
    </SidebarContext.Provider>
  );
}

function FadingLabel({ show, className, children }: { show: boolean; className?: string; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 0.12, ease: EASE_OUT }} className={className}>
          {children}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

export function SidebarHeader({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { collapsed } = useSidebarContext();
  const visible = collapsed ? React.Children.toArray(children).filter((c) => !(React.isValidElement(c) && c.type === SidebarToggle)) : children;
  return (
    <div data-slot="sidebar-header" className={cn("flex shrink-0 items-center", collapsed ? "flex-col justify-center gap-2 px-0 py-3" : "h-14 gap-2.5 px-4", className)} {...props}>
      {visible}
    </div>
  );
}

export function SidebarNav({ className, children, ...props }: React.HTMLAttributes<HTMLElement>) {
  const { navId } = useSidebarContext();
  return <nav id={navId} data-slot="sidebar-nav" aria-label="Main" className={cn("min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain py-2", className)} {...props}>{children}</nav>;
}

export function SidebarSection({ label, className, children, ...props }: React.HTMLAttributes<HTMLDivElement> & { label?: string }) {
  const { collapsed } = useSidebarContext();
  return (
    <div data-slot="sidebar-section" role="group" aria-label={label} className={cn("py-1", className)} {...props}>
      {label && (
        <div className="flex h-6 items-end px-4 pb-1.5">
          <FadingLabel show={!collapsed} className="eyebrow whitespace-nowrap leading-none">{label}</FadingLabel>
        </div>
      )}
      <div className="flex flex-col gap-px px-2">{children}</div>
    </div>
  );
}

const itemBase = cn(
  "group/sidebar-item relative flex w-full items-center gap-2.5 rounded-lg px-3 py-2",
  "text-[13.5px] leading-none font-medium whitespace-nowrap outline-none select-none",
  "transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
);
const pill = "pointer-events-none absolute inset-0 rounded-lg bg-sidebar-accent";

function ActivePill({ navId }: { navId: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <span aria-hidden className={pill} />;
  return <motion.span aria-hidden layoutId={`${navId}-active-pill`} transition={{ type: "spring", stiffness: 520, damping: 42 }} className={pill} />;
}

export interface SidebarItemProps extends React.HTMLAttributes<HTMLElement> {
  icon?: React.ReactNode;
  active?: boolean;
  badge?: React.ReactNode;
  /** Render the single child element (e.g. a Next <Link>) as the item. */
  asChild?: boolean;
  label?: string;
}

export function SidebarItem({ className, icon, active = false, badge, asChild = false, label, children, ...props }: SidebarItemProps) {
  const { collapsed, navId } = useSidebarContext();
  const cls = cn(itemBase, active ? "text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground", className);
  const title = collapsed ? label : undefined;
  const child = asChild && React.isValidElement(children) ? (children as React.ReactElement<{ children?: React.ReactNode }>) : null;
  const text = child ? child.props.children : children;

  const inner = (
    <>
      {active ? <ActivePill navId={navId} /> : null}
      {icon ? <span className="relative z-10 flex size-5 shrink-0 items-center justify-center">{icon}</span> : null}
      <FadingLabel show={!collapsed} className="relative z-10 min-w-0 flex-1 truncate text-left">{text}</FadingLabel>
      {badge ? <FadingLabel show={!collapsed} className="relative z-10 flex shrink-0 items-center">{badge}</FadingLabel> : null}
      {collapsed && label ? <span className="sr-only">{label}</span> : null}
    </>
  );

  const rendered = useRender({
    enabled: Boolean(child),
    render: child ? React.cloneElement(child, { children: inner }) : undefined,
    props: { "data-slot": "sidebar-item", "data-active": active ? "true" : undefined, "aria-current": active ? "page" : undefined, title, className: cls, ...props },
  });
  if (child) return rendered;
  return <button type="button" data-slot="sidebar-item" aria-current={active ? "page" : undefined} title={title} className={cls} {...(props as React.ButtonHTMLAttributes<HTMLButtonElement>)}>{inner}</button>;
}

export function SidebarFooter({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { collapsed } = useSidebarContext();
  return (
    <div data-slot="sidebar-footer" className={cn("flex shrink-0 items-center border-t py-3", collapsed ? "justify-center px-0" : "gap-2.5 px-4", className)} {...props}>
      {children}
    </div>
  );
}

export function SidebarToggle({ className, ...props }: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  const { collapsed, toggleCollapsed } = useSidebarContext();
  return (
    <button
      type="button" onClick={toggleCollapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed}
      className={cn("flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-95 motion-reduce:active:scale-100", className)}
      {...props}
    >
      {collapsed ? <PanelLeftOpen className="size-4" aria-hidden /> : <PanelLeftClose className="size-4" aria-hidden />}
    </button>
  );
}
