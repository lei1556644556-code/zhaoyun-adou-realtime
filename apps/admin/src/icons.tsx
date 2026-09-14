import type { ReactNode, SVGProps } from "react";

export type IconName = "users" | "rooms" | "battle" | "wait" | "command" | "traffic" | "copy" | "search" | "close" | "lock";

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  const paths: Record<IconName, ReactNode> = {
    users: <><circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 6.5a3 3 0 0 1 0 5.8M17 15a4.5 4.5 0 0 1 3.5 4"/></>,
    rooms: <><path d="M5 3h12v18H5zM9 7h4M9 11h4M9 15h4"/><path d="M17 9h3v12h-3"/></>,
    battle: <><path d="m5 4 15 15M19 4 4 19M7 6 4 3M18 17l3 3M17 6l3-3M6 17l-3 3"/></>,
    wait: <><circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/></>,
    command: <><path d="M7 3h10v18H7zM10 7h4M10 11h4M10 15h4"/><path d="M4 6h3M4 12h3M4 18h3"/></>,
    traffic: <><path d="M4 17h16M6 17V9M12 17V4M18 17v-6"/><path d="m4 7 4-4 4 4M16 7l4 4-4 4"/></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="1"/><path d="M16 8V5H5v11h3"/></>,
    search: <><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></>,
    close: <path d="m5 5 14 14M19 5 5 19"/>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>{paths[name]}</svg>;
}
