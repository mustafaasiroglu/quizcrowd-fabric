type Name = 'back' | 'copy' | 'check' | 'close' | 'up' | 'down' | 'trash' | 'settings' | 'adjust' | 'clock' | 'sun' | 'moon' | 'users' | 'user' | 'more' | 'quiz' | 'survey' | 'join' | 'plus' | 'save' | 'play' | 'open' | 'logout' | 'calendar' | 'questions' | 'responses' | 'lock';
const paths: Record<Name, string> = {
  back: 'M15 19l-7-7 7-7',
  copy: 'M8 16H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2m-6 12h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2z',
  check: 'M5 13l4 4L19 7',
  close: 'M6 18L18 6M6 6l12 12',
  up: 'M5 15l7-7 7 7',
  down: 'M19 9l-7 7-7-7',
  adjust: 'M3 6h4m4 0h10M3 12h10m4 0h4M3 18h4m4 0h10M9 3v6M15 9v6M9 15v6',
  trash: 'M19 7l-.867 12.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3M4 7h16',
  settings: 'M10.5 2h3v3l2.5 1 2-2 2 2-2 2 1 2.5h3v3h-3l-1 2.5 2 2-2 2-2-2-2.5 1v3h-3v-3l-2.5-1-2 2-2-2 2-2-1-2.5h-3v-3h3l1-2.5-2-2 2-2 2 2 2.5-1ZM15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18m0 4v5l3 3',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8m0-6v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1',
  moon: 'M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m7-18a4 4 0 1 0 0 8 4 4 0 0 0 0-8m8 1a4 4 0 0 1 0 8m5 9v-2a4 4 0 0 0-3-4',
  user: 'M20 21v-2a6 6 0 0 0-6-6h-4a6 6 0 0 0-6 6v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  quiz: 'M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4M7 8h4m-4 4h3m8-10v8m-4-4h8M7 16h6',
  survey: 'M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4M7 8h4m-4 4h3m8-10v8m-4-4h8M7 16l2 2 4-4',
  join: 'M10 17l5-5-5-5m5 5H3m12-9h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4',
  plus: 'M12 5v14M5 12h14',
  save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2M7 3v6h10V3M7 21v-8h10v8',
  play: 'M8 4l12 8-12 8V4z',
  open: 'M14 3h7v7m0-7L10 14m-1-9H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9',
  calendar: 'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2',
  questions: 'M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8M13 3h8v8h-8V3M7 9h2m-2 4h6m-6 4h6',
  responses: 'M21 11a8 8 0 0 1-8 8H5l-4 3V11a8 8 0 0 1 8-8h4a8 8 0 0 1 8 8M7 11h.01M11 11h.01M15 11h.01',
  lock: 'M7 10V7a5 5 0 0 1 10 0v3M6 10h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2m6 5v3',
};
export function Icon({ name }: { name: Name }) {
  return <svg className="icon" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d={paths[name]} /></svg>;
}
