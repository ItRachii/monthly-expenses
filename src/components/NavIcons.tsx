// Navigation icons: Google Material Symbols (Rounded), outlined normally and
// filled for the page you are on, as Material does. Sized in em so they scale
// with the link's font size.

import type { FC } from "react";
import { MaterialSymbol } from "./Icons";
import type { SymbolName } from "./materialSymbols";

export interface NavIconProps {
  /** The filled variant, for the current page. */
  filled?: boolean;
  className?: string;
}

const size = "h-[1.15em] w-[1.15em]";

function navIcon(name: SymbolName & string): FC<NavIconProps> {
  return function NavIcon({ filled = false, className = size }) {
    return <MaterialSymbol name={(filled ? `${name}-fill` : name) as SymbolName} className={className} />;
  };
}

export const HomeIcon = navIcon("home");
export const AddIcon = navIcon("add_circle");
export const LogIcon = navIcon("list_alt");
export const SummaryIcon = navIcon("bar_chart");
export const SettlementIcon = navIcon("handshake");
export const NotificationsIcon = navIcon("notifications");
export const GroupsIcon = navIcon("group");
export const ProfileIcon = navIcon("account_circle");
export const StatementsIcon = navIcon("credit_card");

export const NAV_ICONS: Record<string, FC<NavIconProps>> = {
  "/": HomeIcon,
  "/add": AddIcon,
  "/log": LogIcon,
  "/summary": SummaryIcon,
  "/settlement": SettlementIcon,
  "/notifications": NotificationsIcon,
  "/groups": GroupsIcon,
  "/profile": ProfileIcon,
  "/statements": StatementsIcon,
};
