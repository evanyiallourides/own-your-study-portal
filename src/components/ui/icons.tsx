/* Hand-rolled rather than an icon package: the portal needs about a dozen
   glyphs, all at one weight, and they should share the hairline vocabulary the
   rest of the interface is drawn in. */

type IconProps = { className?: string };

const base = (className?: string) => ({
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  className,
});

export const HomeIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5.5 9.5V20a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.5" />
  </svg>
);

export const BookIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v15.5H5.5A1.5 1.5 0 0 0 4 20V4.5Z" />
    <path d="M4 20a1.5 1.5 0 0 1 1.5-1.5H19V21H5.5A1.5 1.5 0 0 1 4 19.5" />
  </svg>
);

export const CalendarIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
    <path d="M3.5 9.5h17M8 3v4M16 3v4" />
  </svg>
);

export const ChecklistIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M4 6.5 5.5 8 8.5 5M4 13.5 5.5 15l3-3M4 20.5 5.5 22l3-3" />
    <path d="M12 6.5h8M12 13.5h8M12 20.5h8" />
  </svg>
);

export const ChartIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M4 20V4M4 20h16" />
    <path d="M8 20v-6M12.5 20V8M17 20v-9" />
  </svg>
);

export const CardIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <rect x="3" y="5.5" width="18" height="13" rx="1.8" />
    <path d="M3 10h18" />
    <path d="M6.5 14.5h3" />
  </svg>
);

export const FolderIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18V6.5Z" />
  </svg>
);

export const PeopleIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
    <path d="M16 5.4a3.2 3.2 0 0 1 0 5.2M17.5 20a5.6 5.6 0 0 0-2-4.3" />
  </svg>
);

export const UserIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </svg>
);

export const SettingsIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v2.2M12 18.8V21M21 12h-2.2M5.2 12H3M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6M18.4 18.4l-1.6-1.6M7.2 7.2 5.6 5.6" />
  </svg>
);

export const SparkIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9 12 3.5Z" />
    <path d="M18.5 3.5v3M20 5h-3" />
  </svg>
);

export const SearchIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m20 20-4.8-4.8" />
  </svg>
);

export const ArrowRightIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M4.5 12h15M13.5 6l6 6-6 6" />
  </svg>
);

export const ChevronLeftIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="m14.5 5-7 7 7 7" />
  </svg>
);

export const ChevronDownIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="m5 9 7 7 7-7" />
  </svg>
);

export const CheckIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </svg>
);

export const CloseIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="m6 6 12 12M18 6 6 18" />
  </svg>
);

export const MenuIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

export const VideoIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <rect x="3" y="6" width="12.5" height="12" rx="2" />
    <path d="m15.5 11 5.5-3v8l-5.5-3v-2Z" />
  </svg>
);

export const FileIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M13.5 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V8L13.5 3Z" />
    <path d="M13.5 3v5h5" />
  </svg>
);

export const ImageIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m4.5 17.5 4.8-4.3 4 3.4 2.7-2.3 3.5 3" />
  </svg>
);

export const TranscriptIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M4 5.5h16M4 10h11M4 14.5h16M4 19h8" />
  </svg>
);

export const LogOutIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M15 4.5h3.5A1.5 1.5 0 0 1 20 6v12a1.5 1.5 0 0 1-1.5 1.5H15" />
    <path d="M11 8.5 7.5 12 11 15.5M7.5 12H16" />
  </svg>
);

export const BellIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M6 10a6 6 0 1 1 12 0c0 3.2.8 4.8 1.6 5.7H4.4C5.2 14.8 6 13.2 6 10Z" />
    <path d="M10 19a2 2 0 0 0 4 0" />
  </svg>
);

export const AlertIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M12 4.5 21 20H3l9-15.5Z" />
    <path d="M12 10v4M12 17h.01" />
  </svg>
);

export const ShieldIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M12 3 5 6v6c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6l-7-3Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

export const ClockIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

export const CopyIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
  </svg>
);

export const LinkIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 0 0-5.7-5.7l-1.3 1.3" />
    <path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.3 2.3a4 4 0 0 0 5.7 5.7l1.3-1.3" />
  </svg>
);
