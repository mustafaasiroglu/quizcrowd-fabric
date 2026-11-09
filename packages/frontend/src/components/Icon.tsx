type Name = 'back' | 'copy' | 'check' | 'close' | 'up' | 'down' | 'trash' | 'settings' | 'clock' | 'sun' | 'moon' | 'users' | 'more' | 'quiz' | 'survey';
const paths: Record<Name, string> = {
  back: 'M15 19l-7-7 7-7',
  copy: 'M8 16H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2m-6 12h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2z',
  check: 'M5 13l4 4L19 7',
  close: 'M6 18L18 6M6 6l12 12',
  up: 'M5 15l7-7 7 7',
  down: 'M19 9l-7 7-7-7',
  trash: 'M19 7l-.867 12.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3M4 7h16',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8m-2-5h4l1 3 3 1 3 2v4l-3 2-1 3-3 3h-4l-1-3-3-1-3-2v-4l3-2 1-3z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18m0 4v5l3 3',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8m0-6v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1',
  moon: 'M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m7-18a4 4 0 1 0 0 8 4 4 0 0 0 0-8m8 1a4 4 0 0 1 0 8m5 9v-2a4 4 0 0 0-3-4',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  quiz: 'M7 3h10v18H5V3h2m2 5h6m-6 4h6m-6 4h3',
  survey: 'M5 3h14v18H5V3m4 5h6m-6 4h6m-6 4h6',
};
export function Icon({ name }: { name: Name }) {
  return <svg className="icon" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d={paths[name]} /></svg>;
}
