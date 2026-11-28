/** Small stroke icons in the spirit of SF Symbols. */
type P = { className?: string };
const S = (d: React.ReactNode) =>
  function Icon({ className }: P) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
        {d}
      </svg>
    );
  };

export const IconSummary = S(<><path d="M12 3a9 9 0 1 0 9 9h-9z" /><path d="M15 3.5A9 9 0 0 1 20.5 9H15z" /></>);
export const IconInbox = S(<><path d="M3 13l2.5-7.5A2 2 0 0 1 7.4 4h9.2a2 2 0 0 1 1.9 1.5L21 13" /><path d="M3 13v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5h-5l-1.5 2.5h-5L8 13z" /></>);
export const IconList = S(<><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></>);
export const IconHouse = S(<><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></>);
export const IconPeople = S(<><circle cx="9" cy="8" r="3.2" /><path d="M3 19c.6-3.2 3-5 6-5s5.4 1.8 6 5" /><circle cx="17" cy="9" r="2.5" /><path d="M16.5 14c2.4.2 4 1.8 4.5 4.5" /></>);
export const IconGear = S(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>);
export const IconChevronLeft = S(<path d="M15 5l-7 7 7 7" />);
export const IconChevronRight = S(<path d="M9 5l7 7-7 7" />);
export const IconCheckCircle = S(<><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.8 2.8L16.5 9" /></>);
export const IconAlert = S(<><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17v.01" /></>);
export const IconPlus = S(<path d="M12 5v14M5 12h14" />);
export const IconDownload = S(<><path d="M12 4v11M7 10l5 5 5-5" /><path d="M5 20h14" /></>);
export const IconMail = S(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>);
export const IconBriefcase = S(<><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /></>);
export const IconArrowDown = S(<><path d="M12 5v14M6 13l6 6 6-6" /></>);
export const IconChart = S(<><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>);
export const IconWallet = S(<><rect x="3" y="6" width="18" height="14" rx="2.5" /><path d="M3 10h18" /><path d="M16 15h2" /></>);
export const IconSparkle = S(<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />);
export const IconClock = S(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
