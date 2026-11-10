export function BrandMark() {
  return <svg className="brand-mark" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
    <rect x="2" y="2" width="8" height="8" rx="2" />
    <rect x="14" y="2" width="8" height="8" rx="2" />
    <rect x="2" y="14" width="8" height="8" rx="2" />
    <rect x="15" y="15" width="6" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="2" />
  </svg>;
}

export function Brand({ onHome }: { onHome(): void }) {
  return <button className="brand small-brand" aria-label="QuizCrowd home" onClick={onHome}>
    <BrandMark /><span className="brand-wordmark"><span>Quiz</span><span>Crowd</span></span>
  </button>;
}
