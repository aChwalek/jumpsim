// Line icons for the menu, 24 units a side, drawn in the text colour.

const icon = (body: string, cls = ''): string =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

/** A canopy over its pilot. */
export const ICON_CANOPY = icon(
  '<path d="M2.5 10c2.6-4.4 16.4-4.4 19 0-5.2-1.7-13.8-1.7-19 0Z"/><path d="M3.6 10.4 11 18.2M20.4 10.4 13 18.2M8.8 9.3l2.4 8.9M15.2 9.3l-2.4 8.9"/><circle cx="12" cy="19.6" r="1.5"/>',
);
/** A windsock on its pole. */
export const ICON_DZ = icon('<path d="M5 21V3.5"/><path d="M5 5h12.5l2.5 2.5-2.5 2.5H5"/><path d="M9.5 5v5M14 5v5"/>');
/** The sun behind a cloud. */
export const ICON_WEATHER = icon(
  '<circle cx="9" cy="8.5" r="3.2"/><path d="M9 2.2v1.4M2.7 8.5h1.4M4.5 4l1 1M13.5 4l-1 1"/><path d="M8.6 19.5h8.6a3.6 3.6 0 0 0 .2-7.2 5.2 5.2 0 0 0-9.9 1.5 2.9 2.9 0 0 0 1.1 5.7Z"/>',
);
/** A plane seen from above, nose up, in a 24 square. */
export const PLANE_PATH =
  'M12 2.6c.9 0 1.4 1 1.4 2.4v4.2l7.4 4.4v2l-7.4-2.3v4.2l2.2 1.7V21L12 20.1 8.4 21v-1.8l2.2-1.7v-4.2l-7.4 2.3v-2l7.4-4.4V5c0-1.4.5-2.4 1.4-2.4Z';
export const ICON_PLANE = icon(`<path d="${PLANE_PATH}"/>`);
export const ICON_BOOK = icon('<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5a1.5 1.5 0 0 0 0 3H19M8.5 7h7M8.5 10.5h7"/>');
export const ICON_COG = icon(
  '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/><circle cx="12" cy="12" r="6.6"/>',
);
export const ICON_GLOBE = icon(
  '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3Z"/>',
);
export const ICON_BACK = icon('<path d="M14.5 5.5 8 12l6.5 6.5"/>');
export const ICON_MORE = icon('<path d="M9.5 5.5 16 12l-6.5 6.5"/>');

/** The mark next to the name: a canopy, filled. */
export const LOGO =
  '<svg class="logo" viewBox="0 0 40 40" aria-hidden="true"><path d="M3 15C8 6 32 6 37 15 28 12 12 12 3 15Z" fill="currentColor"/><path d="M5 15.6 18.4 31M35 15.6 21.6 31M13.6 13.4 19 31M26.4 13.4 21 31" stroke="currentColor" stroke-width="1.4" fill="none" opacity=".7"/><circle cx="20" cy="33" r="2.6" fill="currentColor"/></svg>';
/** Two people: jumping with others. */
export const ICON_PEOPLE = icon(
  '<circle cx="9" cy="8" r="3.2"/><path d="M3 19.5c.6-3.4 3-5.3 6-5.3s5.4 1.9 6 5.3"/><path d="M15.5 4.9a3.2 3.2 0 0 1 0 6.2M17.6 14.6c1.8.7 3 2.4 3.4 4.9"/>',
);
/** A lock, on what someone else sets. */
export const ICON_LOCK = icon('<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/>');
