// Stroke icons (currentColor, 24-box), matching the Scelo iconography recipe.
import type { ReactNode } from 'react';

type P = { size?: number; className?: string };
function Svg({ size = 16, className, children }: P & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {children}
    </svg>
  );
}
export const PanelLeft = (p: P) => (
  <Svg {...p}>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <line x1="9" x2="9" y1="3" y2="21" />
  </Svg>
);
export const PanelRight = (p: P) => (
  <Svg {...p}>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <line x1="15" x2="15" y1="3" y2="21" />
  </Svg>
);
export const Play = (p: P) => (
  <Svg {...p}>
    <polygon points="6 3 20 12 6 21 6 3" fill="currentColor" stroke="none" />
  </Svg>
);
export const Pause = (p: P) => (
  <Svg {...p}>
    <rect x="6" y="4" width="4" height="16" fill="currentColor" stroke="none" />
    <rect x="14" y="4" width="4" height="16" fill="currentColor" stroke="none" />
  </Svg>
);
export const StepFwd = (p: P) => (
  <Svg {...p}>
    <polygon points="5 4 15 12 5 20 5 4" fill="currentColor" stroke="none" />
    <line x1="19" x2="19" y1="5" y2="19" />
  </Svg>
);
export const Rewind = (p: P) => (
  <Svg {...p}>
    <polygon points="19 20 9 12 19 4 19 20" fill="currentColor" stroke="none" />
    <line x1="5" x2="5" y1="19" y2="5" />
  </Svg>
);
export const Sun = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
);
export const Moon = (p: P) => (
  <Svg {...p}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </Svg>
);
export const Monitor = (p: P) => (
  <Svg {...p}>
    <rect width="20" height="14" x="2" y="3" rx="2" />
    <line x1="8" x2="16" y1="21" y2="21" />
    <line x1="12" x2="12" y1="17" y2="21" />
  </Svg>
);
export const Settings = (p: P) => (
  <Svg {...p}>
    <path d="M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.6a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7V20a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.6a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);
export const Help = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="10" />
    <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" />
  </Svg>
);
export const Target = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
  </Svg>
);
export const Home = (p: P) => (
  <Svg {...p}>
    <path d="M3 11l9-8 9 8" />
    <path d="M5 10v10h14V10" />
  </Svg>
);
export const Sparkle = (p: P) => (
  <Svg {...p}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    <path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />
  </Svg>
);
export const Close = (p: P) => (
  <Svg {...p}>
    <path d="M18 6L6 18M6 6l12 12" />
  </Svg>
);
export const Chevron = (p: P & { open?: boolean }) => (
  <Svg {...p}>
    <path d={p.open ? 'M6 9l6 6 6-6' : 'M9 6l6 6-6 6'} />
  </Svg>
);
export const Users = (p: P) => (
  <Svg {...p}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
  </Svg>
);
export const Weather = ({ cond, size = 14 }: { cond: string; size?: number }) => {
  if (cond === 'rain' || cond === 'storm') {
    return (
      <Svg size={size}>
        <path d="M20 16.6A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 15.3" />
        <path d="M8 19v2M12 19v2M16 19v2" />
      </Svg>
    );
  }
  if (cond === 'cloudy' || cond === 'fog') {
    return (
      <Svg size={size}>
        <path d="M17.5 19a4.5 4.5 0 0 0 .4-9A7 7 0 1 0 6 19z" />
      </Svg>
    );
  }
  if (cond === 'snow' || cond === 'cold-snap') {
    return (
      <Svg size={size}>
        <path d="M12 2v20M2 12h20M5 5l14 14M19 5L5 19" />
      </Svg>
    );
  }
  return <Sun size={size} />;
};

export const Church = (p: P) => (
  <Svg {...p}>
    <path d="M12 2v4M10 4h4" />
    <path d="M5 21v-8l7-5 7 5v8" />
    <path d="M9 21v-4a3 3 0 0 1 6 0v4" />
  </Svg>
);
export const Trees = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="4.2" />
    <path d="M8 12.2V21" />
    <circle cx="16.8" cy="11" r="3.2" />
    <path d="M16.8 14.2V21" />
  </Svg>
);
export const Bus = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="13" rx="2.2" />
    <path d="M3.5 11h17" />
    <circle cx="8" cy="19.5" r="1.6" />
    <circle cx="16" cy="19.5" r="1.6" />
  </Svg>
);
export const Plane = (p: P) => (
  <Svg {...p}>
    <path d="M10.5 20.5l1.5-6 6.5-3.5a1.6 1.6 0 0 0-1.4-2.9L10.6 9.6 5 6.5 3.5 7.6l4 3.4-2.2 1.3-2.4-.6-1 1 3.3 2.4 1.4 3.9 1.3-.6.2-2.6 2.4-1.2z" />
  </Svg>
);
export const Train = (p: P) => (
  <Svg {...p}>
    <rect x="5" y="3.5" width="14" height="13" rx="3.5" />
    <path d="M5 10h14M9 20.5l-1.5 2M15 20.5l1.5 2M8 16.5l-1 4h10l-1-4" />
    <circle cx="9" cy="13.5" r="0.9" />
    <circle cx="15" cy="13.5" r="0.9" />
  </Svg>
);
export const Landmark = (p: P) => (
  <Svg {...p}>
    <path d="M3 21h18" />
    <path d="M5.5 17.5v-7M10 17.5v-7M14 17.5v-7M18.5 17.5v-7" />
    <path d="M3 8.5L12 3l9 5.5H3z" />
  </Svg>
);
export const Hospital = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <path d="M12 9v6M9 12h6" />
  </Svg>
);
export const Stadium = (p: P) => (
  <Svg {...p}>
    <ellipse cx="12" cy="12" rx="9" ry="6" />
    <ellipse cx="12" cy="12" rx="4.5" ry="2.6" />
  </Svg>
);
export const Tower = (p: P) => (
  <Svg {...p}>
    <path d="M4 21h16" />
    <rect x="6" y="3.5" width="8" height="17.5" rx="1" />
    <path d="M14 9.5h4.5v11.5" />
    <path d="M9 7.5h2M9 11h2M9 14.5h2" />
  </Svg>
);
export const Expand = (p: P & { open?: boolean }) => (
  <Svg {...p}>
    {p.open ? (
      <>
        <path d="M9 3v6H3M15 21v-6h6M3 15h6v6M21 9h-6V3" />
      </>
    ) : (
      <>
        <path d="M3 9V3h6M21 15v6h-6M15 3h6v6M9 21H3v-6" />
      </>
    )}
  </Svg>
);

// ── The Community Builder: tools and the library's assets ──
export const Cursor = (p: P) => (
  <Svg {...p}>
    <path d="M5 3l14 7-6 1.8L10.2 18z" />
  </Svg>
);
export const Hand = (p: P) => (
  <Svg {...p}>
    <path d="M7 11V5.5a1.5 1.5 0 0 1 3 0V10" />
    <path d="M10 9.5V4a1.5 1.5 0 0 1 3 0v5.5" />
    <path d="M13 9.5V5.5a1.5 1.5 0 0 1 3 0V11" />
    <path d="M16 10.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.5a7 7 0 0 1-5.6-2.8L3.6 15a1.6 1.6 0 0 1 2.4-2.1L7 14" />
  </Svg>
);
export const Road = (p: P) => (
  <Svg {...p}>
    <path d="M7 21L10 3M17 21L14 3" />
    <path d="M12 19v-2M12 13v-2M12 7V5" />
  </Svg>
);
export const Street = (p: P) => (
  <Svg {...p}>
    <path d="M3 13h18" />
    <path d="M4 9.5l2.5-2.5L9 9.5V12H4zM15 9.5l2.5-2.5L20 9.5V12h-5z" />
    <path d="M4 15v4.5h5V15M15 15v4.5h5V15" />
  </Svg>
);
export const Zone = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="1.5" strokeDasharray="3 2.6" />
    <path d="M8 15.5l2.5-2.5 2 2 3.5-4" />
  </Svg>
);
export const Frame = (p: P) => (
  <Svg {...p}>
    <path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5" />
    <rect x="8" y="8" width="8" height="8" rx="1" />
  </Svg>
);
export const Rail = (p: P) => (
  <Svg {...p}>
    <path d="M8 3v18M16 3v18" />
    <path d="M6 6h12M6 10h12M6 14h12M6 18h12" />
  </Svg>
);
export const Eraser = (p: P) => (
  <Svg {...p}>
    <path d="M7 21h12" />
    <path d="M5.5 15.5l9-9a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L13 18H8z" />
    <path d="M10 10l5 5" />
  </Svg>
);
export const Undo = (p: P) => (
  <Svg {...p}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Svg>
);
export const Redo = (p: P) => (
  <Svg {...p}>
    <path d="M15 14l5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </Svg>
);
export const Grid = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
  </Svg>
);
export const Layers = (p: P) => (
  <Svg {...p}>
    <path d="M12 3l9 5-9 5-9-5z" />
    <path d="M3 13l9 5 9-5" />
  </Svg>
);
export const Save = (p: P) => (
  <Svg {...p}>
    <path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
    <path d="M7 3v5h8V3M7 21v-7h10v7" />
  </Svg>
);
export const Folder = (p: P) => (
  <Svg {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Svg>
);
export const FilePlus = (p: P) => (
  <Svg {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M12 11v6M9 14h6" />
  </Svg>
);
export const Upload = (p: P) => (
  <Svg {...p}>
    <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    <path d="M12 3v12M7 8l5-5 5 5" />
  </Svg>
);
export const Download = (p: P) => (
  <Svg {...p}>
    <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    <path d="M12 3v12M7 10l5 5 5-5" />
  </Svg>
);
export const Rotate = (p: P) => (
  <Svg {...p}>
    <path d="M20 12a8 8 0 1 1-2.6-5.9" />
    <path d="M20 4v5h-5" />
  </Svg>
);
export const Trash = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h16M10 11v6M14 11v6" />
    <path d="M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Svg>
);
export const Copy = (p: P) => (
  <Svg {...p}>
    <rect x="8" y="8" width="13" height="13" rx="2" />
    <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
  </Svg>
);
export const Fit = (p: P) => (
  <Svg {...p}>
    <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
  </Svg>
);
export const CheckCircle = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12.5l2.7 2.7L16 9.5" />
  </Svg>
);
export const Alert = (p: P) => (
  <Svg {...p}>
    <path d="M10.3 4.2L2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" />
    <path d="M12 9.5v4.5M12 17.5v.01" />
  </Svg>
);
export const Info = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v6M12 7.5v.01" />
  </Svg>
);
export const Hammer = (p: P) => (
  <Svg {...p}>
    <path d="M14 7l-9.5 9.5a2.1 2.1 0 0 0 3 3L17 10" />
    <path d="M12 5l3-2 6 6-2 3-2-2-2 2-3-3 2-2z" />
  </Svg>
);
export const Search = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-4-4" />
  </Svg>
);
// Assets
export const School = (p: P) => (
  <Svg {...p}>
    <path d="M2 9l10-5 10 5-10 5z" />
    <path d="M6 11v5c3.5 2.5 8.5 2.5 12 0v-5" />
    <path d="M22 9v6" />
  </Svg>
);
export const Clinic = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <path d="M12 8v8M8 12h8" />
  </Svg>
);
export const Medical = (p: P) => (
  <Svg {...p}>
    <path d="M5 4v5a5 5 0 0 0 10 0V4" />
    <path d="M10 14v2a4 4 0 0 0 8 0v-2" />
    <circle cx="18" cy="12" r="2" />
  </Svg>
);
export const Ambulance = (p: P) => (
  <Svg {...p}>
    <path d="M3 7h11v10H3zM14 10h4l3 3v4h-7" />
    <circle cx="7" cy="18" r="2" />
    <circle cx="17" cy="18" r="2" />
    <path d="M8.5 9.5v4M6.5 11.5h4" />
  </Svg>
);
export const Shield = (p: P) => (
  <Svg {...p}>
    <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" />
    <path d="M12 8l1.2 2.5 2.8.4-2 1.9.5 2.7L12 14.2l-2.5 1.3.5-2.7-2-1.9 2.8-.4z" />
  </Svg>
);
export const Scales = (p: P) => (
  <Svg {...p}>
    <path d="M12 3v18M7 21h10M5 7h14" />
    <path d="M5 7l-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z" />
  </Svg>
);
export const Mail = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 7l9 6 9-6" />
  </Svg>
);
export const Store = (p: P) => (
  <Svg {...p}>
    <path d="M3 9l2-5h14l2 5" />
    <path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
    <path d="M5 12v8h14v-8M10 20v-5h4v5" />
  </Svg>
);
export const Basket = (p: P) => (
  <Svg {...p}>
    <path d="M3 10h18l-2 10H5z" />
    <path d="M8 10l3-6M16 10l-3-6M9 14v3M15 14v3M12 14v3" />
  </Svg>
);
export const Cup = (p: P) => (
  <Svg {...p}>
    <path d="M5 8h12v6a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5z" />
    <path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17M8 2.5v2.5M12 2.5v2.5" />
  </Svg>
);
export const Pill = (p: P) => (
  <Svg {...p}>
    <rect x="2.5" y="8" width="19" height="8" rx="4" transform="rotate(-45 12 12)" />
    <path d="M8.5 8.5l7 7" />
  </Svg>
);
export const Bag = (p: P) => (
  <Svg {...p}>
    <path d="M5 8h14l-1 13H6z" />
    <path d="M9 8V6a3 3 0 0 1 6 0v2" />
  </Svg>
);
export const Banknote = (p: P) => (
  <Svg {...p}>
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.6" />
    <path d="M6 9v.01M18 15v.01" />
  </Svg>
);
export const Vault = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="15" rx="2" />
    <circle cx="12" cy="11.5" r="4" />
    <path d="M12 9.5v4M10 11.5h4M6 19v2M18 19v2" />
  </Svg>
);
export const Briefcase = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 12.5h18" />
  </Svg>
);
export const Wrench = (p: P) => (
  <Svg {...p}>
    <path d="M14.5 6.5a4 4 0 0 0 5 5L20 12l-8.5 8.5a2.1 2.1 0 0 1-3-3L17 9l.5-.5a4 4 0 0 1-3-2z" />
  </Svg>
);
export const Sprout = (p: P) => (
  <Svg {...p}>
    <path d="M12 21v-9" />
    <path d="M12 12c0-4 3-7 8-7 0 4-3 7-8 7zM12 14c0-3.4-2.6-6-7-6 0 3.4 2.6 6 7 6z" />
  </Svg>
);
export const Car = (p: P) => (
  <Svg {...p}>
    <path d="M5 16V11l2.2-5h9.6L19 11v5" />
    <path d="M3 16h18v2H3zM5 11h14" />
    <circle cx="7.5" cy="18.5" r="1.5" />
    <circle cx="16.5" cy="18.5" r="1.5" />
  </Svg>
);
export const Square = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="1" />
    <circle cx="12" cy="12" r="2.5" />
  </Svg>
);
export const Ball = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7l3.8 2.8-1.5 4.4h-4.6l-1.5-4.4z" />
    <path d="M12 3v4M20.5 9.3l-4.7.5M17 19.5l-2.7-5.3M7 19.5l2.7-5.3M3.5 9.3l4.7.5" />
  </Svg>
);
export const Music = (p: P) => (
  <Svg {...p}>
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </Svg>
);
export const Book = (p: P) => (
  <Svg {...p}>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z" />
    <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
  </Svg>
);
export const Headstone = (p: P) => (
  <Svg {...p}>
    <path d="M6 21V10a6 6 0 0 1 12 0v11" />
    <path d="M3 21h18M12 9v6M9.5 11.5h5" />
  </Svg>
);
