import { useEffect, useRef, useState } from 'react';
import type { SurveyQuestionResult, SurveyWrittenPage } from '@rayfin-app/shared';

type LoadWritten = (questionIndex: number, offset: number) => Promise<SurveyWrittenPage>;

function WrittenResponses({ result, onLoad }: { result: SurveyQuestionResult; onLoad?: LoadWritten }) {
  const [values, setValues] = useState(result.writtenResponses ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function more() {
    setBusy(true); setError('');
    try {
      if (!onLoad) throw new Error('More written responses are unavailable. Reload the results.');
      const page = await onLoad(result.questionIndex, values.length);
      if (page.questionIndex !== result.questionIndex || page.offset !== values.length ||
          !page.values.length || page.total !== result.writtenCount) throw new Error('Written responses changed. Reload the results.');
      if (active.current) setValues(previous => [...previous, ...page.values]);
    } catch (e) {
      if (active.current) setError(e instanceof Error ? e.message : 'Written responses could not be loaded.');
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return <div className="written-responses">
    <p className="muted small">Written responses · Owner only</p>
    {!result.writtenCount ? <p className="muted">No written responses collected.</p> : <>
      <ul aria-label={`Written responses for question ${result.questionIndex + 1}`}>{values.map((text, index) => <li key={index}>{text}</li>)}</ul>
      <p className="muted small" role="status">Showing {values.length} of {result.writtenCount} written responses</p>
      {values.length < result.writtenCount && <button type="button" className="subtle" disabled={busy} onClick={() => void more()}>{busy ? 'Loading responses...' : 'Load more written responses'}</button>}
    </>}
    {error && <p role="alert">{error}</p>}
  </div>;
}

function ResponseChart({ result, onLoad }: { result: SurveyQuestionResult; onLoad?: LoadWritten }) {
  const ranked = [...result.selections].sort((a, b) => b.count - a.count || (a.option ?? 10) - (b.option ?? 10));
  const top = ranked.filter(answer => answer.count > 0).slice(0, 3);
  const rest = ranked.filter(answer => !top.includes(answer));
  const tied = ranked.some((answer, index) => answer.count > 0 && ranked[index + 1]?.count === answer.count);
  function bar(answer: SurveyQuestionResult['selections'][number]) {
    const percent = Math.round(answer.count / result.responseCount * 1000) / 10;
    return <><div className="survey-bar-label"><span>{answer.label}</span><strong>{answer.count} / {result.responseCount} · {percent}%</strong></div>
      <div className="survey-bar-track" aria-hidden="true"><span style={{ width: `${percent}%` }} /></div></>;
  }
  function selection(answer: SurveyQuestionResult['selections'][number]) {
    return <li key={answer.option ?? 'other'} data-selection={answer.option ?? 'other'}>
      {answer.option === null && result.writtenResponses !== undefined ? <details className="written-choice"
        onPointerEnter={event => { if (event.pointerType === 'mouse') event.currentTarget.open = true; }}
        onPointerLeave={event => { if (!event.currentTarget.contains(document.activeElement)) event.currentTarget.open = false; }}
        onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); event.stopPropagation(); } }}>
        <summary aria-label={`Other: ${answer.count} of ${result.responseCount} respondents. Show written responses`}>{bar(answer)}<span className="muted small">Hover, tap or press Enter to view written responses</span></summary>
        <WrittenResponses result={result} onLoad={onLoad} />
      </details> : bar(answer)}
    </li>;
  }
  return <>
    <h3>Top 3 selections</h3>
    <ol className="survey-bars" aria-label="Top three selections">{top.map(selection)}</ol>
    <p className="muted small">Percentages use {result.responseCount} respondent{result.responseCount !== 1 ? 's' : ''}.{result.allowMultiple && ' Multiple selections can total more than 100%.'}</p>
    {tied && <p className="muted small">Equal counts follow the question's answer order.</p>}
    {!!rest.length && <details className="remaining-choices"><summary>Remaining choices ({rest.length})</summary><ul className="survey-bars" aria-label="Remaining choices">{rest.map(selection)}</ul></details>}
  </>;
}

export function SurveyResults({ results, onLoadWritten }: { results: SurveyQuestionResult[]; onLoadWritten?: LoadWritten }) {
  return <div className="survey-results" aria-label="Survey question summaries">
    {results.map(result => <section key={result.questionIndex} className="survey-result">
      <h2>Question {result.questionIndex + 1}</h2><p>{result.text}</p>
      <p className="muted small">{result.responseCount} response{result.responseCount !== 1 ? 's' : ''}</p>
      {!result.responseCount ? <p className="muted">No responses collected.</p> : result.textOnly
        ? result.writtenResponses !== undefined ? <WrittenResponses result={result} onLoad={onLoadWritten} />
          : <p className="muted">{result.writtenCount} written response{result.writtenCount !== 1 ? 's' : ''} collected. Written responses are visible only to the session owner.</p>
        : <ResponseChart result={result} onLoad={onLoadWritten} />}
    </section>)}
  </div>;
}
