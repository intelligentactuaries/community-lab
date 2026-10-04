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
