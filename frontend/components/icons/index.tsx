import type { SVGProps } from "react";
import styles from "./Icons.module.css";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function IconBase({ size = 20, children, className = "", ...props }: IconProps & { children: React.ReactNode }) {
  const cls = [styles.icon, className].filter(Boolean).join(" ");
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={cls} fill="currentColor" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

export const GraduationCap = (props: IconProps) => <IconBase {...props}><path d="M2 9 12 4l10 5-10 5L2 9Zm4 3v4c0 1.2 3 2.5 6 2.5s6-1.3 6-2.5v-4l-6 3-6-3Z" /></IconBase>;
export const BookOpen = (props: IconProps) => <IconBase {...props}><path d="M3 5.5A2.5 2.5 0 0 1 5.5 3H12v17H5.5A2.5 2.5 0 0 1 3 17.5v-12Zm18 0v12A2.5 2.5 0 0 1 18.5 20H12V3h6.5A2.5 2.5 0 0 1 21 5.5Z" /></IconBase>;
export const Clock = (props: IconProps) => <IconBase {...props}><path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm1 5h-2v6l5 3 1-1.7-4-2.3V7Z" /></IconBase>;
export const Trophy = (props: IconProps) => <IconBase {...props}><path d="M6 3h12v3a5 5 0 0 1-4 4.9V14h3v2H7v-2h3v-3.1A5 5 0 0 1 6 6V3Zm-3 2h3v1a4 4 0 0 1-3 3.9V5Zm18 0v4.9A4 4 0 0 1 18 6V5h3Z" /></IconBase>;
export const Play = (props: IconProps) => <IconBase {...props}><path d="M8 5v14l11-7L8 5Z" /></IconBase>;
export const Flag = (props: IconProps) => <IconBase {...props}><path d="M5 2h2v20H5V2Zm2 2h11l-2 4 2 4H7V4Z" /></IconBase>;
export const ChevronLeft = (props: IconProps) => <IconBase {...props}><path d="m15.5 4 2 2-6 6 6 6-2 2-8-8 8-8Z" /></IconBase>;
export const ChevronRight = (props: IconProps) => <IconBase {...props}><path d="m8.5 20-2-2 6-6-6-6 2-2 8 8-8 8Z" /></IconBase>;
export const ChevronUp = (props: IconProps) => <IconBase {...props}><path d="m4 15.5 2 2 6-6 6 6 2-2-8-8-8 8Z" /></IconBase>;
export const ChevronDown = (props: IconProps) => <IconBase {...props}><path d="m20 8.5-2-2-6 6-6-6-2 2 8 8 8-8Z" /></IconBase>;
export const Printer = (props: IconProps) => <IconBase {...props}><path d="M7 3h10v4H7V3Zm11 6a3 3 0 0 1 3 3v5h-4v4H7v-4H3v-5a3 3 0 0 1 3-3h12Zm-3 10v-5H9v5h6Z" /></IconBase>;
export const Trash2 = (props: IconProps) => <IconBase {...props}><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-2 6h2v9H7V9Zm4 0h2v9h-2V9Zm4 0h2v9h-2V9Z" /></IconBase>;
export const Edit = (props: IconProps) => <IconBase {...props}><path d="m16.8 3.2 4 4L9 19H5v-4L16.8 3.2ZM4 21h16v-2H4v2Z" /></IconBase>;
export const Plus = (props: IconProps) => <IconBase {...props}><path d="M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7V4Z" /></IconBase>;
export const Search = (props: IconProps) => <IconBase {...props}><path d="M10 2a8 8 0 1 1 4.9 14.3l5.4 5.4-1.4 1.4-5.4-5.4A8 8 0 0 1 10 2Zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z" /></IconBase>;
export const Wifi = (props: IconProps) => <IconBase {...props}><path d="M12 18a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm0-4c2.4 0 4.6.9 6.4 2.5l-1.4 1.4A7.1 7.1 0 0 0 12 16c-2 0-3.8.7-5.1 1.9l-1.4-1.4A9.1 9.1 0 0 1 12 14Zm0-4c3.5 0 6.7 1.3 9.2 3.6l-1.4 1.4A11.1 11.1 0 0 0 12 12c-3 0-5.8 1.1-7.8 3l-1.4-1.4A13.1 13.1 0 0 1 12 10Z" /></IconBase>;
export const WifiOff = (props: IconProps) => <IconBase {...props}><path d="m2.7 2.7 18.6 18.6-1.4 1.4-3.2-3.2A8.9 8.9 0 0 0 12 18a9 9 0 0 0-4.7 1.5l-1.4-1.4A11 11 0 0 1 12 16c1 0 2 .1 2.9.4l-2-2c-.3 0-.6 0-.9 0-2 0-3.8.7-5.1 1.9l-1.4-1.4a9.1 9.1 0 0 1 5.1-2.4L7.7 9.7A13 13 0 0 0 2.8 13l-1.4-1.4A15 15 0 0 1 6.2 8.4L1.3 3.5l1.4-1.4ZM12 10h-.2l-2-2H12c3.5 0 6.7 1.3 9.2 3.6L19.8 13A11.1 11.1 0 0 0 12 10Zm0 8a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z" /></IconBase>;
export const LogOut = (props: IconProps) => <IconBase {...props}><path d="M10 3h9a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-9v-2h9V5h-9V3ZM3 12l4-4v3h8v2H7v3l-4-4Z" /></IconBase>;
export const Award = (props: IconProps) => <IconBase {...props}><path d="M12 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12Zm-3 12 3 3 3-3 3 8-6-3-6 3 3-8Z" /></IconBase>;
export const AlertCircle = (props: IconProps) => <IconBase {...props}><path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm1 5h-2v7h2V7Zm0 9h-2v2h2v-2Z" /></IconBase>;
export const Database = (props: IconProps) => <IconBase {...props}><path d="M12 2c5 0 9 1.8 9 4v12c0 2.2-4 4-9 4s-9-1.8-9-4V6c0-2.2 4-4 9-4Zm0 2c-4.1 0-7 .9-7 2s2.9 2 7 2 7-.9 7-2-2.9-2-7-2Zm0 6c-2.8 0-5.3-.5-7-1.4V12c0 1.1 2.9 2 7 2s7-.9 7-2V8.6c-1.7.9-4.2 1.4-7 1.4Zm0 6c-2.8 0-5.3-.5-7-1.4V18c0 1.1 2.9 2 7 2s7-.9 7-2v-3.4c-1.7.9-4.2 1.4-7 1.4Z" /></IconBase>;
export const Download = (props: IconProps) => <IconBase {...props}><path d="M11 3h2v10l3-3 1.4 1.4L12 17l-5.4-5.6L8 10l3 3V3ZM4 19h16v2H4v-2Z" /></IconBase>;
export const Upload = (props: IconProps) => <IconBase {...props}><path d="M13 21h-2V11l-3 3-1.4-1.4L12 7l5.4 5.6L16 14l-3-3v10ZM4 3h16v2H4V3Z" /></IconBase>;
export const Users = (props: IconProps) => <IconBase {...props}><path d="M9 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm8-1a3 3 0 1 1 0-6 3 3 0 0 1 0 6ZM2 20a7 7 0 0 1 14 0H2Zm12 0a6 6 0 0 1 8 0h-8Z" /></IconBase>;
export const Shield = (props: IconProps) => <IconBase {...props}><path d="M12 2 4 5v6c0 5.2 3.4 9.9 8 11 4.6-1.1 8-5.8 8-11V5l-8-3Zm-1 6h2v6h-2V8Zm0 8h2v2h-2v-2Z" /></IconBase>;
export const Check = (props: IconProps) => <IconBase {...props}><path d="m9 16.2-3.5-3.5-1.4 1.4L9 19 20 8l-1.4-1.4L9 16.2Z" /></IconBase>;
export const UserCheck = (props: IconProps) => <IconBase {...props}><path d="M10 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm8.3-2.7 1.4 1.4-4.6 4.6-2.8-2.8 1.4-1.4 1.4 1.4 3.2-3.2ZM2 20a8 8 0 0 1 12.6-6.5l-1.4 1.4A6 6 0 0 0 4 20H2Z" /></IconBase>;
export const X = (props: IconProps) => <IconBase {...props}><path d="m6.7 5.3 5.3 5.3 5.3-5.3 1.4 1.4-5.3 5.3 5.3 5.3-1.4 1.4-5.3-5.3-5.3 5.3-1.4-1.4 5.3-5.3-5.3-5.3 1.4-1.4Z" /></IconBase>;
export const Menu = (props: IconProps) => <IconBase {...props}><path d="M3 6h18v2H3V6Zm0 5h18v2H3v-2Zm0 5h18v2H3v-2Z" /></IconBase>;
export const Home = (props: IconProps) => <IconBase {...props}><path d="M12 3 2 11h3v10h6v-6h2v6h6V11h3L12 3Z" /></IconBase>;
