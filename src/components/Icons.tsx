import type { ReactNode, SVGProps } from "react";

const make = (d: ReactNode) =>
  function Icon(p: SVGProps<SVGSVGElement>) {
    return (
      <svg
        viewBox="0 0 24 24"
        width="1em"
        height="1em"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        {...p}
      >
        {d}
      </svg>
    );
  };

export const IconRefresh = make(<><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 4v5h-5" /></>);
export const IconPull = make(<><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>);
export const IconPush = make(<><path d="M12 21V9" /><path d="m7 14 5-5 5 5" /><path d="M5 3h14" /></>);
export const IconFetch = make(<><path d="M7 18a4.5 4.5 0 1 1 1.4-8.8A6 6 0 0 1 20 11a3.5 3.5 0 0 1-1 7" /><path d="m9 16 3 3 3-3" /><path d="M12 12v7" /></>);
export const IconBranch = make(<><circle cx="6" cy="5" r="2.2" /><circle cx="6" cy="19" r="2.2" /><circle cx="18" cy="8" r="2.2" /><path d="M6 7.2v9.6" /><path d="M18 10.2c0 5-12 2.5-12 6.6" /></>);
export const IconStash = make(<><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9" /><path d="M10 13h4" /></>);
export const IconPop = make(<><path d="M12 20v-8" /><path d="m8.5 15.5 3.5-3.5 3.5 3.5" /><path d="M4 8h16" /><path d="M6 8V5a1 1 0 0 1 1-1h12" /></>);
export const IconPlus = make(<><path d="M12 5v14" /><path d="M5 12h14" /></>);
export const IconMinus = make(<path d="M5 12h14" />);
export const IconClose = make(<><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>);
export const IconSearch = make(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>);
export const IconTag = make(<><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" /><circle cx="7.5" cy="7.5" r="1.3" /></>);
export const IconChevronRight = make(<path d="m9 6 6 6-6 6" />);
export const IconChevronDown = make(<path d="m6 9 6 6 6-6" />);
export const IconFile = make(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>);
export const IconFolder = make(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />);
export const IconSun = make(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>);
export const IconMoon = make(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />);
export const IconCloud = make(<path d="M7 18a4.5 4.5 0 1 1 1.4-8.8A6 6 0 0 1 20 11a3.5 3.5 0 0 1-1 7z" />);
export const IconCheck = make(<path d="m5 12 5 5 9-10" />);
export const IconTerminal = make(<><path d="m4 17 6-5-6-5" /><path d="M12 19h8" /></>);
export const IconLayers = make(<><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></>);
export const IconUndo = make(<><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></>);
export const IconFilter = make(<path d="M3 5h18l-7 8v6l-4-2v-4z" />);
export const IconHistory = make(<><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /><path d="M12 8v5l3 2" /></>);
export const IconCommit = make(<><circle cx="12" cy="12" r="3.5" /><path d="M3 12h5.5M15.5 12H21" /></>);
export const IconFolderOpen = make(<><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1" /><path d="M3 19l2.5-9h16L19 19z" /></>);
export const IconClone = make(<><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>);
export const IconSliders = make(<><path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>);
export const IconPuzzle = make(<path d="M10 3a2 2 0 0 1 4 0v2h4a1 1 0 0 1 1 1v4h-2a2 2 0 0 0 0 4h2v4a1 1 0 0 1-1 1h-4v-2a2 2 0 0 0-4 0v2H6a1 1 0 0 1-1-1v-4h2a2 2 0 0 0 0-4H5V6a1 1 0 0 1 1-1h4z" />);
export const IconGrip = make(<><circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" /></>);
