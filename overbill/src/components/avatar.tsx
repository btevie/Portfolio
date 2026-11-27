import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";

/** Profile picture, or the person's initials on a soft green circle when they have none. */
export function Avatar({ name, email, picture, size = 56, className }: { name?: string; email?: string; picture?: string; size?: number; className?: string }) {
  const label = initials(name?.trim() || (email ?? "").split("@")[0]) || "?";
  return (
    <span role="img" aria-label={name ? `${name}'s profile picture` : "Profile picture"} className={cn("relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-[#d4e0d8] font-semibold text-[#1e4a36] select-none dark:bg-green-900/50 dark:text-green-100", className)} style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {picture
        // eslint-disable-next-line @next/next/no-img-element -- user-chosen data URL or external avatar
        ? <img src={picture} alt="" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" />
        : <span aria-hidden>{label}</span>}
    </span>
  );
}
