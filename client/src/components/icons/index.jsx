/**
 * Tiny inline icon set. Each is a stroke-based 16-by-16 SVG that follows
 * `currentColor`, so they pick up text color automatically.
 */
import React from 'react';
const base = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };

export const HomeIcon = (p) => (<svg {...base} {...p}><path d="M3 12l9-9 9 9"/><path d="M5 10v10h14V10"/></svg>);
export const FolderIcon = (p) => (<svg {...base} {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>);
export const PuzzleIcon = (p) => (<svg {...base} {...p}><path d="M14 4a2 2 0 1 0-4 0v3H7a2 2 0 0 0-2 2v3a2 2 0 1 1 0 4v3a2 2 0 0 0 2 2h3v-3a2 2 0 1 1 4 0v3h3a2 2 0 0 0 2-2v-3a2 2 0 1 0 0-4V9a2 2 0 0 0-2-2h-3z"/></svg>);
export const GlobeIcon = (p) => (<svg {...base} {...p}><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>);
export const UsersIcon = (p) => (<svg {...base} {...p}><path d="M17 21v-2a4 4 0 0 0-3-3.87"/><path d="M7 21v-2a4 4 0 0 1 4-4h2"/><circle cx="9" cy="7" r="4"/><path d="M17 11a4 4 0 1 0-3-7"/></svg>);
export const TerminalIcon = (p) => (<svg {...base} {...p}><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>);
export const ArchiveIcon = (p) => (<svg {...base} {...p}><rect x="3" y="3" width="18" height="4" rx="1"/><path d="M5 7v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7"/><line x1="10" y1="12" x2="14" y2="12"/></svg>);
export const SlidersIcon = (p) => (<svg {...base} {...p}><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>);
export const SunIcon = (p) => (<svg {...base} {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>);
export const MoonIcon = (p) => (<svg {...base} {...p}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>);
export const LogOutIcon = (p) => (<svg {...base} {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>);
export const PlusIcon = (p) => (<svg {...base} {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>);
export const ChevronDownIcon = (p) => (<svg {...base} {...p}><polyline points="6 9 12 15 18 9"/></svg>);
export const ChevronRightIcon = (p) => (<svg {...base} {...p}><polyline points="9 18 15 12 9 6"/></svg>);
export const PlayIcon = (p) => (<svg {...base} {...p}><polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none"/></svg>);
export const StopIcon = (p) => (<svg {...base} {...p}><rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" stroke="none"/></svg>);
export const RestartIcon = (p) => (<svg {...base} {...p}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>);
export const TrashIcon = (p) => (<svg {...base} {...p}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>);
export const UploadIcon = (p) => (<svg {...base} {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>);
export const DownloadIcon = (p) => (<svg {...base} {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>);
export const SearchIcon = (p) => (<svg {...base} {...p}><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>);
export const RefreshIcon = (p) => (<svg {...base} {...p}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15A9 9 0 1 1 18 5.51L23 10"/></svg>);
export const PencilIcon = (p) => (<svg {...base} {...p}><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>);
export const SendIcon = (p) => (<svg {...base} {...p}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>);
export const MenuIcon = (p) => (<svg {...base} {...p}><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>);
export const LockIcon = (p) => (<svg {...base} {...p}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>);
export const ServerIcon = (p) => (<svg {...base} {...p}><rect x="2" y="3" width="20" height="8" rx="2"/><rect x="2" y="13" width="20" height="8" rx="2"/><line x1="6" y1="7" x2="6.01" y2="7"/><line x1="6" y1="17" x2="6.01" y2="17"/></svg>);
