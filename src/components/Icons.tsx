// Icons for actions and controls, all Google Material Symbols (Rounded,
// weight 400). One source for every icon in the app: navigation uses the same
// set through NavIcons.tsx. Icons take the text colour (currentColor).
//
// Sizes: 20px (h-5 w-5, the default) inside `.icon-btn`; 16px (h-4 w-4) next
// to text inside a `.btn`; 12px (h-3 w-3) for the tiny thumbnail remover.
//
// To add an icon, list it in scripts/material-symbols.mjs and run it.

import type { SVGProps } from "react";
import { SYMBOLS, type SymbolName } from "./materialSymbols";

type IconProps = SVGProps<SVGSVGElement> & { className?: string };

/** Any generated Material Symbol by name, e.g. <MaterialSymbol name="home-fill" />. */
export function MaterialSymbol({ name, className = "h-5 w-5", ...rest }: IconProps & { name: SymbolName }) {
  return (
    <svg viewBox="0 -960 960 960" fill="currentColor" className={`shrink-0 ${className}`} aria-hidden {...rest}>
      <path d={SYMBOLS[name]} />
    </svg>
  );
}

const icon = (name: SymbolName) =>
  function Icon(p: IconProps) {
    return <MaterialSymbol {...p} name={name} />;
  };

export const ArrowLeftIcon = icon("arrow_back");
export const SettingsIcon = icon("settings");
export const PencilIcon = icon("edit");
export const TrashIcon = icon("delete");
export const XIcon = icon("close");
export const CheckIcon = icon("check");
export const ReceiptIcon = icon("receipt_long");
export const FileUploadIcon = icon("upload_file");
export const CameraIcon = icon("photo_camera");
export const ImageIcon = icon("image");
export const MenuIcon = icon("menu");
export const ChevronRightIcon = icon("chevron_right");
export const ChevronDownIcon = icon("keyboard_arrow_down");
export const LogOutIcon = icon("logout");
export const RefreshIcon = icon("refresh");
export const ClockIcon = icon("schedule");
export const WifiOffIcon = icon("wifi_off");
export const AlertTriangleIcon = icon("warning");
export const EyeIcon = icon("visibility");
export const EyeOffIcon = icon("visibility_off");
export const MinusIcon = icon("remove");
export const PlusIcon = icon("add");
export const TrendingUpIcon = icon("trending_up");
export const TrendingDownIcon = icon("trending_down");
export const GroupAddIcon = icon("group_add");
export const AddCircleIcon = icon("add_circle");
export const PaymentsIcon = icon("payments");
export const MailIcon = icon("mail");
export const WalletIcon = icon("account_balance_wallet-fill");
export const SunIcon = icon("light_mode");
export const MoonIcon = icon("dark_mode");
export const AutoThemeIcon = icon("brightness_auto");
export const SortIcon = icon("unfold_more");
export const ArrowUpIcon = icon("arrow_upward");
export const ArrowDownIcon = icon("arrow_downward");
export const SearchIcon = icon("search");
export const LabelIcon = icon("label");
export const DownloadIcon = icon("download");
export const CalendarIcon = icon("calendar_month");
export const FilterIcon = icon("filter_list");
export const PeopleIcon = icon("group");
