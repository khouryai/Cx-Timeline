/**
 * Icon system — inline SVG, themed via `currentColor`.
 *
 * Same approach as cx-portal: a flat map of 24×24 stroke paths rendered into
 * an <svg> on demand, so icons inherit text colour and font size and need no
 * sprite sheet, font file or network request. Every glyph carries search
 * keywords for the icon picker.
 *
 * Imports: nothing (leaf).
 */

/**
 * name → [pathMarkup, 'search keywords', 'category']
 * Paths use fill="none" stroke="currentColor" unless they set fill inline.
 */
const ICONS = {
  /* ── Rail & operations ─────────────────────────────────────────────── */
  train: ['<rect x="4" y="3" width="16" height="13" rx="2"/><path d="M4 11h16"/><path d="M9 3v8"/><path d="M15 3v8"/><circle cx="8.5" cy="13.5" r="1"/><circle cx="15.5" cy="13.5" r="1"/><path d="m6 16-2 5"/><path d="m18 16 2 5"/><path d="M8 21h8"/>', 'train rail vehicle metro rolling stock consist', 'Rail'],
  rail: ['<path d="M4 3v18"/><path d="M20 3v18"/><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>', 'rail track sleeper permanent way alignment', 'Rail'],
  signal: ['<rect x="8" y="2" width="8" height="14" rx="4"/><circle cx="12" cy="6" r="1.4"/><circle cx="12" cy="12" r="1.4"/><path d="M12 16v6"/><path d="M9 22h6"/>', 'signal aspect lamp head wayside', 'Rail'],
  switchpoint: ['<path d="M3 18h6l6-12h6"/><path d="M3 12h8"/><path d="m18 3 3 3-3 3"/>', 'switch point turnout junction diverge', 'Rail'],
  platform: ['<path d="M2 16h20"/><path d="M4 16v-4h6v4"/><path d="M14 16v-6h6v6"/><path d="M2 20h20"/>', 'platform station stop halt', 'Rail'],
  tunnel: ['<path d="M4 21V12a8 8 0 0 1 16 0v9"/><path d="M9 21v-9a3 3 0 0 1 6 0v9"/>', 'tunnel bore portal underground', 'Rail'],
  depot: ['<path d="M3 21V9l9-6 9 6v12"/><path d="M9 21v-7h6v7"/>', 'depot shed stabling yard building', 'Rail'],
  power: ['<path d="M12 2v8"/><path d="M6 10h12"/><path d="M8 10v4a4 4 0 0 0 8 0v-4"/><path d="M12 18v4"/>', 'power traction catenary substation electrical', 'Rail'],

  /* ── Status & assurance ────────────────────────────────────────────── */
  warning: ['<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><path d="M12 9v4"/><path d="M12 17h.01"/>', 'warning alert caution risk hazard triangle', 'Status'],
  alert: ['<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><path d="M12 9v4"/><path d="M12 17h.01"/>', 'alert warning risk caution', 'Status'],
  check: ['<path d="M20 6 9 17l-5-5"/>', 'check tick done complete pass ok', 'Status'],
  'check-circle': ['<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>', 'check circle passed complete approved', 'Status'],
  x: ['<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', 'close x cancel remove fail', 'Status'],
  'x-circle': ['<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>', 'fail rejected cancelled error', 'Status'],
  flag: ['<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>', 'flag milestone marker gate', 'Status'],
  bug: ['<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13V6a3 3 0 1 1 6 0v1.13"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M6 13H2"/><path d="M22 13h-4"/><path d="m6 8-2-1"/><path d="m20 7-2 1"/><path d="m6 18-2 1"/><path d="m20 19-2-1"/>', 'bug defect issue fault ncr', 'Status'],
  shield: ['<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>', 'shield safety assurance protection', 'Status'],
  ban: ['<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>', 'blocked banned stop prohibited', 'Status'],
  pause: ['<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>', 'pause hold suspended freeze', 'Status'],
  play: ['<polygon points="6 3 20 12 6 21 6 3"/>', 'play start run go', 'Status'],
  scale: ['<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>', 'decision scale balance judgement approval', 'Status'],

  /* ── Time ──────────────────────────────────────────────────────────── */
  calendar: ['<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>', 'calendar date schedule plan', 'Time'],
  'calendar-check': ['<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/>', 'calendar complete scheduled confirmed', 'Time'],
  clock: ['<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>', 'clock time duration hours', 'Time'],
  timer: ['<path d="M10 2h4"/><path d="M12 14v-4"/><circle cx="12" cy="14" r="8"/>', 'timer countdown remaining deadline', 'Time'],
  history: ['<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>', 'history version revision previous restore', 'Time'],
  hourglass: ['<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22"/><path d="M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4a2 2 0 0 0 .6-1.4V2"/>', 'hourglass elapsed slip float duration', 'Time'],

  /* ── Systems & infrastructure ──────────────────────────────────────── */
  database: ['<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>', 'database data store sql records', 'Systems'],
  server: ['<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 6h.01"/><path d="M6 18h.01"/>', 'server rack host machine scada', 'Systems'],
  laptop: ['<path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9"/><path d="M2 16h20l-1.4 3a2 2 0 0 1-1.8 1H5.2a2 2 0 0 1-1.8-1z"/>', 'laptop computer workstation terminal', 'Systems'],
  monitor: ['<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>', 'monitor display screen hmi console', 'Systems'],
  cloud: ['<path d="M17.5 19a4.5 4.5 0 0 0 .5-8.98A6 6 0 0 0 6.2 9.5 4.5 4.5 0 0 0 6.5 19z"/>', 'cloud remote hosted saas', 'Systems'],
  network: ['<rect x="9" y="2" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="16" y="16" width="6" height="6" rx="1"/><path d="M12 8v4"/><path d="M5 16v-2h14v2"/>', 'network topology lan comms backbone', 'Systems'],
  wifi: ['<path d="M5 12.55a11 11 0 0 1 14 0"/><path d="M8.5 16.4a6 6 0 0 1 7 0"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M12 20h.01"/>', 'wifi radio wireless coverage comms', 'Systems'],
  cpu: ['<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>', 'cpu processor board hardware ixl', 'Systems'],
  cable: ['<path d="M4 9a5 5 0 0 1 5-5v0a5 5 0 0 1 5 5v6a5 5 0 0 0 5 5v0a5 5 0 0 0 5-5"/><path d="M2 9h4"/><path d="M18 15h4"/>', 'cable wiring loom harness connection', 'Systems'],
  antenna: ['<path d="M12 12v10"/><path d="m8 8 4 4 4-4"/><path d="M5 5a9 9 0 0 1 14 0"/><path d="M2 2a13 13 0 0 1 20 0"/>', 'antenna radio transmitter balise', 'Systems'],

  /* ── Objects & content ─────────────────────────────────────────────── */
  document: ['<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>', 'document file paper spec report', 'Content'],
  file: ['<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>', 'file document attachment', 'Content'],
  folder: ['<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>', 'folder directory group set', 'Content'],
  clipboard: ['<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>', 'clipboard test procedure checklist package', 'Content'],
  package: ['<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>', 'package release build software version drop', 'Content'],
  camera: ['<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>', 'camera photo evidence capture', 'Content'],
  image: ['<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>', 'image picture photo drawing', 'Content'],
  comment: ['<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', 'comment note sticky remark message', 'Content'],
  bulb: ['<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>', 'idea callout insight lightbulb highlight', 'Content'],
  paperclip: ['<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>', 'attachment clip file link', 'Content'],
  type: ['<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/>', 'text type label caption font', 'Content'],
  table: ['<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/>', 'table grid matrix rows', 'Content'],
  list: ['<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>', 'list bullet items register', 'Content'],
  checklist: ['<path d="M11 6h10"/><path d="M11 12h10"/><path d="M11 18h10"/><path d="m3 6 1.5 1.5L7 5"/><path d="m3 12 1.5 1.5L7 11"/><path d="m3 18 1.5 1.5L7 17"/>', 'checklist tasks todo punch', 'Content'],

  /* ── People & organisation ─────────────────────────────────────────── */
  user: ['<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>', 'user person owner engineer assignee', 'People'],
  users: ['<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>', 'users team crew customer stakeholders', 'People'],
  share: ['<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4"/><path d="M15.4 6.5l-6.8 4"/>', 'share access permission collaborate invite', 'People'],
  logout: ['<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>', 'logout sign out leave exit account', 'People'],
  building: ['<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M8 10h.01"/><path d="M16 10h.01"/><path d="M8 14h.01"/><path d="M16 14h.01"/>', 'building client office organisation site', 'People'],
  globe: ['<circle cx="12" cy="12" r="10"/><path d="M12 2a15 15 0 0 1 0 20"/><path d="M12 2a15 15 0 0 0 0 20"/><path d="M2 12h20"/>', 'globe world region international site', 'People'],
  handshake: ['<path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.9-3.9a2 2 0 0 1 0-2.8l.4-.4a3 3 0 0 0-4.2 0l-1 1a2 2 0 0 1-2.8 0L7 7"/><path d="m21 3-6 6"/><path d="M3 21l6-6"/>', 'handshake agreement acceptance contract', 'People'],

  /* ── Tools & UI ────────────────────────────────────────────────────── */
  gear: ['<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>', 'gear settings configuration preferences cog', 'Tools'],
  settings: ['<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>', 'settings gear options config', 'Tools'],
  wrench: ['<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>', 'wrench maintenance tool repair works', 'Tools'],
  zap: ['<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>', 'lightning zap power outage energy fast', 'Tools'],
  bell: ['<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>', 'bell notification alarm reminder', 'Tools'],
  lock: ['<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', 'lock locked freeze protected secure', 'Tools'],
  unlock: ['<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>', 'unlock unlocked editable open', 'Tools'],
  eye: ['<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>', 'eye visible show view', 'Tools'],
  'eye-off': ['<path d="M9.9 4.24A9 9 0 0 1 12 4c6.5 0 10 7 10 7a17 17 0 0 1-2.6 3.53"/><path d="M6.6 6.6A17 17 0 0 0 2 11s3.5 7 10 7a9 9 0 0 0 4.4-1.1"/><path d="m2 2 20 20"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>', 'hidden invisible hide off', 'Tools'],
  search: ['<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>', 'search find filter lookup magnify', 'Tools'],
  filter: ['<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>', 'filter narrow refine subset', 'Tools'],
  layers: ['<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>', 'layers stack order z-index group', 'Tools'],
  copy: ['<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>', 'copy duplicate clone clipboard', 'Tools'],
  trash: ['<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>', 'delete trash remove bin', 'Tools'],
  edit: ['<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>', 'edit pencil rename modify', 'Tools'],
  plus: ['<path d="M5 12h14"/><path d="M12 5v14"/>', 'add new plus create', 'Tools'],
  minus: ['<path d="M5 12h14"/>', 'minus remove subtract collapse', 'Tools'],
  undo: ['<path d="M3 7v6h6"/><path d="M3 13a9 9 0 1 0 3-7.7L3 8"/>', 'undo revert back step', 'Tools'],
  redo: ['<path d="M21 7v6h-6"/><path d="M21 13a9 9 0 1 1-3-7.7L21 8"/>', 'redo forward repeat', 'Tools'],
  save: ['<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>', 'save store write disk', 'Tools'],
  download: ['<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><path d="M12 15V3"/>', 'download export save out', 'Tools'],
  upload: ['<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><path d="M12 3v12"/>', 'upload import load in', 'Tools'],
  print: ['<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/>', 'print pdf paper output', 'Tools'],
  link: ['<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/>', 'link dependency connect relationship', 'Tools'],
  unlink: ['<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 0 1 3.5 8.5"/><path d="m2 2 20 20"/>', 'unlink disconnect break dependency', 'Tools'],
  target: ['<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>', 'target campaign goal objective aim', 'Tools'],
  activity: ['<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>', 'activity task work bar progress', 'Tools'],
  chart: ['<line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/>', 'chart graph analysis metrics', 'Tools'],
  grid: ['<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>', 'grid gridlines layout tiles', 'Tools'],
  map: ['<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15"/><path d="M15 6v15"/>', 'map minimap navigator overview', 'Tools'],
  maximize: ['<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>', 'maximize fullscreen expand present', 'Tools'],
  minimize: ['<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>', 'minimize shrink exit fullscreen', 'Tools'],
  'zoom-in': ['<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><path d="M11 8v6"/><path d="M8 11h6"/>', 'zoom in magnify closer', 'Tools'],
  'zoom-out': ['<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><path d="M8 11h6"/>', 'zoom out wider further', 'Tools'],
  move: ['<path d="M5 9 2 12l3 3"/><path d="m9 5 3-3 3 3"/><path d="m15 19-3 3-3-3"/><path d="m19 9 3 3-3 3"/><path d="M2 12h20"/><path d="M12 2v20"/>', 'move pan drag reposition', 'Tools'],
  hand: ['<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>', 'hand pan grab drag', 'Tools'],
  cursor: ['<path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51z"/>', 'select pointer cursor arrow', 'Tools'],
  square: ['<rect x="3" y="3" width="18" height="18" rx="2"/>', 'square rectangle shape box', 'Shapes'],
  circle: ['<circle cx="12" cy="12" r="9"/>', 'circle ellipse round shape', 'Shapes'],
  triangle: ['<path d="M12 3 22 20H2z"/>', 'triangle shape warning', 'Shapes'],
  diamond: ['<path d="m12 2 10 10-10 10L2 12z"/>', 'diamond milestone rhombus gate', 'Shapes'],
  star: ['<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>', 'star favourite key important', 'Shapes'],
  hexagon: ['<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>', 'hexagon shape node', 'Shapes'],
  arrow: ['<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>', 'arrow direction next forward', 'Shapes'],
  'arrow-left': ['<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>', 'arrow back previous left', 'Shapes'],
  'chevron-down': ['<path d="m6 9 6 6 6-6"/>', 'chevron down expand caret', 'Shapes'],
  'chevron-right': ['<path d="m9 18 6-6-6-6"/>', 'chevron right collapse caret', 'Shapes'],
  'chevron-left': ['<path d="m15 18-6-6 6-6"/>', 'chevron left back caret', 'Shapes'],
  'chevron-up': ['<path d="m18 15-6-6-6 6"/>', 'chevron up collapse caret', 'Shapes'],
  more: ['<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>', 'more menu options ellipsis', 'Tools'],
  menu: ['<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>', 'menu hamburger navigation', 'Tools'],
  sun: ['<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>', 'sun light theme bright day', 'Tools'],
  moon: ['<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>', 'moon dark theme night', 'Tools'],
  palette: ['<circle cx="13.5" cy="6.5" r="1"/><circle cx="17.5" cy="10.5" r="1"/><circle cx="8.5" cy="7.5" r="1"/><circle cx="6.5" cy="12.5" r="1"/><path d="M12 2a10 10 0 0 0 0 20 2.5 2.5 0 0 0 2-4 2.5 2.5 0 0 1 2-4h2a4 4 0 0 0 4-4 10 10 0 0 0-10-8z"/>', 'palette theme colour style appearance', 'Tools'],
  sliders: ['<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>', 'sliders controls adjust properties inspector', 'Tools'],
  refresh: ['<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>', 'refresh reload sync reset', 'Tools'],
  info: ['<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>', 'info help about details', 'Tools'],
  help: ['<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>', 'help question support shortcuts', 'Tools'],
  keyboard: ['<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01"/><path d="M10 10h.01"/><path d="M14 10h.01"/><path d="M18 10h.01"/><path d="M8 14h8"/>', 'keyboard shortcuts keys hotkeys', 'Tools'],
  pin: ['<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>', 'pin location marker place area', 'Tools'],
  tag: ['<path d="M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.41l8.7 8.71a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".8" fill="currentColor"/>', 'tag label category subsystem', 'Tools'],
  bookmark: ['<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>', 'bookmark baseline saved snapshot', 'Tools'],
  compare: ['<path d="M12 3v18"/><path d="M8 7 4 11l4 4"/><path d="m16 7 4 4-4 4"/><path d="M4 11h6"/><path d="M14 11h6"/>', 'compare baseline variance difference slip', 'Tools'],
  route: ['<circle cx="6" cy="19" r="3"/><path d="M9 19h6a4 4 0 0 0 0-8H9a4 4 0 0 1 0-8h6"/><circle cx="18" cy="5" r="3"/>', 'route path critical dependency chain', 'Tools'],
  expand: ['<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>', 'expand fit zoom extent', 'Tools'],
  external: ['<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>', 'external open new link out', 'Tools'],
};

/** Every icon name, in registry order. */
export const ICON_NAMES = Object.keys(ICONS);

/**
 * Render an icon as SVG markup.
 * @param {string} name
 * @param {{size?:number|string, cls?:string, stroke?:number}} [opts]
 */
export function icon(name, opts = {}) {
  const entry = ICONS[name];
  if (!entry) return '';
  const size = opts.size || '1em';
  const dim = typeof size === 'number' ? `${size}` : size;
  const cls = 'icon-svg' + (opts.cls ? ' ' + opts.cls : '');
  const stroke = opts.stroke || 2;
  return (
    `<svg class="${cls}" width="${dim}" height="${dim}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" ` +
    `aria-hidden="true" focusable="false">${entry[0]}</svg>`
  );
}

/** Render an icon straight to a detached SVG element. */
export function iconEl(name, opts = {}) {
  const wrapper = document.createElement('span');
  wrapper.innerHTML = icon(name, opts);
  return wrapper.firstElementChild;
}

export function hasIcon(name) {
  return Object.prototype.hasOwnProperty.call(ICONS, name);
}

/** Raw path markup — used by the SVG and PDF exporters. */
export function iconPath(name) {
  return ICONS[name] ? ICONS[name][0] : '';
}

/**
 * Search the library. An empty query returns everything, so the picker can
 * use one code path for browse and search.
 */
export function searchIcons(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return ICON_NAMES.slice();
  const terms = q.split(/\s+/);
  return ICON_NAMES.filter((name) => {
    const haystack = `${name} ${ICONS[name][1]} ${ICONS[name][2]}`.toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
}

/** Icons grouped by category, for the browse view of the picker. */
export function iconCategories() {
  const groups = new Map();
  for (const name of ICON_NAMES) {
    const category = ICONS[name][2] || 'Other';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(name);
  }
  return Array.from(groups, ([name, icons]) => ({ name, icons }));
}
