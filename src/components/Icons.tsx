import type { ComponentChildren } from 'preact';

/** Iconos de trazo redondeado, como el logotipo. */
function Icon({ children }: { children: ComponentChildren }) {
  return (
    <svg
      class="icon"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconShare = () => (
  <Icon>
    <path d="M12 15V3.5M8 7l4-4 4 4M6 11H5v9.5h14V11h-1" />
  </Icon>
);
export const IconSearch = () => (
  <Icon>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m15.5 15.5 5 5" />
  </Icon>
);
export const IconClose = () => (
  <Icon>
    <path d="m6 6 12 12M18 6 6 18" />
  </Icon>
);
export const IconUp = () => (
  <Icon>
    <path d="M12 20V4.5M5.5 11 12 4.5l6.5 6.5" />
  </Icon>
);
export const IconPhone = () => (
  <Icon>
    <path d="M5 3.5h3.5l2 5-2.4 1.7a12 12 0 0 0 5.7 5.7l1.7-2.4 5 2V19a2 2 0 0 1-2 2A16 16 0 0 1 3 5.500a2 2 0 0 1 2-2Z" />
  </Icon>
);
export const IconPin = () => (
  <Icon>
    <path d="M12 21.500s-7-6-7-11.500a7 7 0 0 1 14 0c0 5.500-7 11.500-7 11.500Z" />
    <circle cx="12" cy="10" r="2.500" />
  </Icon>
);
export const IconInstagram = () => (
  <Icon>
    <rect x="3.500" y="3.500" width="17" height="17" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <path d="M17 7h.01" />
  </Icon>
);
export const IconFacebook = () => (
  <Icon>
    <path d="M14 21v-8h3l.5-3.500H14V7.500c0-1 .5-2 2-2h1.500V2.600A14 14 0 0 0 15 2.500c-2.600 0-4.500 1.600-4.500 4.500v2.500h-3V13h3v8" />
  </Icon>
);
export const IconAlert = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.500v5.500M12 16.500h.01" />
  </Icon>
);

export const IconPlay = () => (
  <svg class="icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
    <path d="M8 5.600v12.800a1 1 0 0 0 1.500.860l10.200-6.400a1 1 0 0 0 0-1.720L9.500 4.740A1 1 0 0 0 8 5.600Z" fill="currentColor" />
  </svg>
);
export const IconPause = () => (
  <svg class="icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
    <path d="M7 5h3.500v14H7zM13.500 5H17v14h-3.500z" fill="currentColor" />
  </svg>
);
