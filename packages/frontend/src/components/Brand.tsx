export function BrandMark() {
  return <svg className="brand-mark" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
    <rect x="2" y="2" width="8" height="8" rx="1" />
    <circle cx="18" cy="6" r="4" />
    <path d="M6 13 11 22H1Z" />
    <rect className="brand-secondary" x="14" y="14" width="8" height="8" rx="1" />
  </svg>;
}

export function Brand({ onHome }: { onHome(): void }) {
  return <button className="brand small-brand" aria-label="QuizCrowd home" onClick={onHome}>
    <BrandMark /><span className="brand-wordmark"><span>Quiz</span><span>Crowd</span></span>
  </button>;
}
