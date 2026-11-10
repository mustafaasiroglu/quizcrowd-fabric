import { describe, expect, it } from 'vitest';
import { decodeSurveyResponse, encodeSurveyResponse, MAX_SURVEY_ANSWER_LENGTH, MAX_SURVEY_TEXT_LENGTH } from '../packages/shared/src/index';
import type { Question, SurveyResponse } from '../packages/shared/src/index';
import { answer, control, createGame, draftSchema, join, preview, surveyResponse, surveyWrittenPage, view } from '../rayfin/functions/src/domain';

const settings = { anonymousEnabled: true, guestEpoch: 7 };
const question: Question = { text: 'Your feedback?', options: ['A|B', 'C\\D', 'Third'], correctIndex: null, duration: 60, survey: { other: true, allowMultiple: true } };
const draft = { title: 'Feedback', mode: 'survey', visibility: 'public', publicAcknowledged: true, lateJoin: false, showAnswer: 'wait_all', questions: [question] };
function fixture(q: Question = question) {
  const game = createGame({ ...draft, questions: [q] }, 'owner', settings, 1000);
  const alice = join(game, 'Alice', null, settings, 1000);
  const bob = join(game, 'Bob', null, settings, 1000);
  control(game, 'start', game.version, 'owner', 2000);
  return { game, alice, bob };
}
describe('versioned single-field survey encoding', () => {
  it.each(['Plain text', 'literal | pipe', 'literal \\ backslash', '\\|o:5|t:injection\\', 'line one\nline two', '|'.repeat(500)])('roundtrips escaped text %j', other => {
    const response = { options: [0, 2], other };
    const encoded = encodeSurveyResponse(response);
    expect(encoded.startsWith('o:0|o:2|t:')).toBe(true);
    expect(encoded.length).toBeLessThanOrEqual(MAX_SURVEY_ANSWER_LENGTH);
    expect(decodeSurveyResponse(encoded)).toEqual(response);
  });
  it('uses explicit metadata rather than guessing a legacy answer format', () => {
    const { game, alice } = fixture();
    const response = { options: [2, 0], other: '  A|B\\C  ' };
    answer(game, alice.token, null, settings, 0, response, 3000);
    const saved = JSON.parse(JSON.stringify(game));
    expect(saved.answers[0]).toMatchObject({ option: 'o:0|o:2|t:A\\|B\\\\C', format: 'survey-v1', correct: false, points: 0 });
    expect(saved.answers[0].option).not.toContain('Third');
    expect(view(saved, alice.token, null, settings, 3000).myResponse).toEqual({ options: [0, 2], other: 'A|B\\C' });
    saved.answers[0].format = 'future-unknown-format';
    expect(() => view(saved, alice.token, null, settings, 3000)).toThrow('Unsupported persisted');
  });
  it.each(['', 'o:0|o:0', 'o:10', 't:', 't:x|o:0', 't:x|t:y', 't:x\\', 't:x\\q', 'unversioned text', 't:' + 'x'.repeat(501)])('fails explicitly on malformed stored encoding %j', encoded => {
    expect(() => decodeSurveyResponse(encoded)).toThrow();
  });
});
describe('survey authoring and submission rules', () => {
  it('projects completed-question counts and owner-only written text only in results', () => {
    const { game, alice, bob } = fixture();
    game.questions.push({ ...question, text: 'Future private question' });
    answer(game, alice.token, null, settings, 0, { options: [0], other: 'Private Alice feedback' }, 3000);
    expect(view(game, '', 'owner', settings, 3000, true).surveyResults).toBeUndefined();
    answer(game, bob.token, null, settings, 0, { options: [1] }, 3100);
    expect(view(game, alice.token, null, settings, 3100).surveyResults).toBeUndefined();
    for (const result of [view(game, '', 'owner', settings, 7100, true)]) {
      expect(result.surveyResults).toMatchObject([{ questionIndex: 0, text: question.text, responseCount: 2, writtenCount: 1, textOnly: false,
        mostSelected: [{ label: 'A|B', count: 1 }, { label: 'C\\D', count: 1 }, { label: 'Other', count: 1 }],
        selections: [{ label: 'A|B', count: 1, option: 0 }, { label: 'C\\D', count: 1, option: 1 },
          { label: 'Third', count: 0, option: 2 }, { label: 'Other', count: 1, option: null }], allowMultiple: true }]);
      expect(result.rankings).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain('Future private question');
      expect(result.correctIndex).toBeUndefined();
    }
    expect(view(game, '', 'owner', settings, 7100, true).surveyResults?.[0].writtenResponses).toEqual(['Private Alice feedback']);
    expect(view(game, bob.token, null, settings, 7100).surveyResults).toBeUndefined();
    expect(JSON.stringify(view(game, bob.token, null, settings, 7100))).not.toContain('Private Alice feedback');
    expect(() => view(game, bob.token, null, { ...settings, anonymousEnabled: false }, 7100)).toThrow();
    expect(() => view(game, '', 'not-owner', settings, 7100, true)).toThrow();
  });
  it('omits all survey result aggregates and text from signed-in and guest attendee snapshots in every phase', () => {
    const game = createGame(draft, 'owner', settings, 1000);
    const attendees = [{ subject: null, ticket: join(game, 'Guest', null, settings, 1000) },
      { subject: 'entra-subject', ticket: join(game, 'Member', 'entra-subject', settings, 1000) }];
    join(game, 'Unanswered', 'other-subject', settings, 1000);
    control(game, 'start', game.version, 'owner', 2000);
    answer(game, attendees[0].ticket.token, null, settings, 0, { options: [], other: 'Guest private prose' }, 3000);
    answer(game, attendees[1].ticket.token, 'entra-subject', settings, 0, { options: [0], other: 'Member private prose' }, 3100);
    for (const phase of ['question', 'reveal', 'leaderboard', 'finished'] as const) {
      game.phase = phase;
      for (const { subject, ticket } of attendees) {
        const result = view(game, ticket.token, subject, settings, 3200);
        for (const field of ['distribution', 'otherCount', 'surveyResults', 'rankings', 'correctIndex', 'myResult']) expect(result).not.toHaveProperty(field);
        expect(result.answerCount).toBe(1);
        expect(result.myResponse?.other).toBe(subject ? 'Member private prose' : 'Guest private prose');
        expect(JSON.stringify(result)).not.toContain(subject ? 'Guest private prose' : 'Member private prose');
        expect(() => surveyWrittenPage(game, subject, 0, 0)).toThrow();
      }
    }
  });
  it('handles text-only and unanswered questions without ranking text or zero-count options', () => {
    const { game, alice, bob } = fixture({ ...question, options: [], survey: { other: true, allowMultiple: false } });
    answer(game, alice.token, null, settings, 0, { options: [], other: 'Secret one' }, 3000);
    answer(game, bob.token, null, settings, 0, { options: [], other: 'Secret two' }, 3100);
    const result = view(game, '', 'owner', settings, 7100, true);
    expect(result.surveyResults?.[0]).toMatchObject({ textOnly: true, writtenCount: 2, responseCount: 2, mostSelected: [] });
    expect(result.surveyResults?.[0].writtenResponses).toEqual(['Secret one', 'Secret two']);
    expect(view(game, bob.token, null, settings, 7100).surveyResults).toBeUndefined();
    const empty = fixture();
    view(empty.game, '', 'owner', settings, 62000, true);
    expect(view(empty.game, '', 'owner', settings, 66000, true).surveyResults?.[0]).toMatchObject({ responseCount: 0, writtenCount: 0, mostSelected: [] });
  });
  it('pages bounded owner-only written text without identities and rejects unfinished or future questions', () => {
    const { game, alice } = fixture();
    expect(() => surveyWrittenPage(game, 'owner', 0, 0)).toThrow('completed');
    answer(game, alice.token, null, settings, 0, { options: [], other: 'Feedback' }, 3000);
    game.phase = 'finished';
    const original = game.answers[0];
    game.answers = Array.from({ length: 47 }, (_, index) => ({ ...original, participantId: `private-${index}`,
      option: encodeSurveyResponse({ options: [], other: `Written ${index}` }) }));
    expect(view(game, '', 'owner', settings, 7100, true).surveyResults?.[0].writtenResponses).toHaveLength(20);
    const pages = [0, 20, 40].map(offset => surveyWrittenPage(game, 'owner', 0, offset));
    expect(pages.map(page => page.values.length)).toEqual([20, 20, 7]);
    expect(pages.flatMap(page => page.values)).toEqual(Array.from({ length: 47 }, (_, i) => `Written ${i}`));
    expect(JSON.stringify(pages)).not.toContain('private-');
    for (const subject of [null, 'not-owner', 'admin']) expect(() => surveyWrittenPage(game, subject, 0, 0)).toThrow();
    for (const [index, offset] of [[1, 0], [-1, 0], [0, -1], [0, 500], [0, 0.5]]) {
      expect(() => surveyWrittenPage(game, 'owner', index, offset)).toThrow();
    }
    game.mode = 'quiz';
    expect(() => surveyWrittenPage(game, 'owner', 0, 0)).toThrow();
  });
  it('permits zero or one normal choices only with Other enabled and rejects quiz extensions', () => {
    for (const options of [[], ['A']]) {
      expect(draftSchema.safeParse({ ...draft, questions: [{ ...question, options, survey: { other: true, allowMultiple: false } }] }).success).toBe(true);
      expect(draftSchema.safeParse({ ...draft, questions: [{ ...question, options, survey: { other: false, allowMultiple: false } }] }).success).toBe(false);
    }
    expect(draftSchema.safeParse({ ...draft, questions: [{ ...question, options: [] }] }).success).toBe(false);
    expect(draftSchema.safeParse({ ...draft, mode: 'quiz', questions: [{ ...question, correctIndex: 0 }] }).success).toBe(false);
    expect(draftSchema.safeParse({ ...draft, questions: [{ ...question, survey: { other: true, allowMultiple: true, unexpected: true } }] }).success).toBe(false);
  });
  it('supports Other-only answers without requiring a fake normal option', () => {
    const q = { ...question, options: [], survey: { other: true, allowMultiple: false } };
    const { game, alice, bob } = fixture(q);
    answer(game, alice.token, null, settings, 0, { options: [], other: '  Feedback | thanks\\  ' }, 3000);
    expect(view(game, alice.token, null, settings, 3000).myResponse).toEqual({ options: [], other: 'Feedback | thanks\\' });
    answer(game, bob.token, null, settings, 0, { options: [], other: 'Second response' }, 3100);
    expect(view(game, '', 'owner', settings, 3100, true)).toMatchObject({ distribution: [], otherCount: 2 });
  });
  it.each([
    { options: [] }, { options: [0, 0] }, { options: [-1] }, { options: [3] }, { options: [0.5] },
    { options: ['0'] }, { options: [0], other: '' }, { options: [], other: '   ' },
    { options: [], other: 'x'.repeat(501) }, { options: [], other: 'x\u0000y' },
    { options: [0], unexpected: 'text' }, { options: [0], otherSelected: false, other: 'Stale text' },
  ])('rejects invalid input %j', input => {
    expect(() => surveyResponse(question, input)).toThrow();
  });
  it('limits text to 500 UTF-16 code units and rejects Other when disabled or multiple when off', () => {
    expect(surveyResponse(question, { options: [], other: 'x'.repeat(MAX_SURVEY_TEXT_LENGTH) }).other).toHaveLength(500);
    const single = { ...question, survey: { other: true, allowMultiple: false } };
    for (const response of [{ options: [0, 1] }, { options: [0], other: 'Text' }]) expect(() => surveyResponse(single, response)).toThrow();
    expect(() => surveyResponse({ ...question, survey: { other: false, allowMultiple: true } }, { options: [], other: 'Text' })).toThrow();
    expect(() => surveyResponse({ ...question, survey: undefined }, { options: [0, 1] })).toThrow();
  });
  it('canonicalizes selection order and text for idempotent retries without changing awards', () => {
    const { game, alice } = fixture();
    answer(game, alice.token, null, settings, 0, { options: [2, 0], other: ' Answer ' }, 3000);
    answer(game, alice.token, null, settings, 0, { options: [0, 2], other: 'Answer' }, 3001);
    expect(game.answers).toHaveLength(1);
    expect(game.participants[0]).toMatchObject({ score: 0, streak: 0 });
    expect(() => answer(game, alice.token, null, settings, 0, { options: [0], other: 'Changed' }, 3002)).toThrow('cannot be changed');
  });
  it('preserves legacy numeric single answers, including retries, distributions and no scoring', () => {
    const { game, alice, bob } = fixture({ ...question, survey: undefined });
    game.answers.push({ participantId: game.participants[0].id, questionIndex: 0, option: 1, correct: false, points: 0 });
    answer(game, alice.token, null, settings, 0, { options: [1] }, 3000);
    expect(game.answers[0].option).toBe(1);
    expect(game.answers[0].format).toBeUndefined();
    answer(game, bob.token, null, settings, 0, 0, 3000);
    expect(view(game, alice.token, null, settings, 3000)).toMatchObject({ myOption: 1, myResponse: { options: [1] } });
    expect(view(game, alice.token, null, settings, 3000).distribution).toBeUndefined();
    expect(view(game, '', 'owner', settings, 3000, true).distribution).toEqual([1, 1, 0]);
  });
  it('returns only own free text and aggregate counts, before and after reveal', () => {
    const { game, alice, bob } = fixture();
    answer(game, alice.token, null, settings, 0, { options: [0, 2], other: 'Private Alice feedback' }, 3000);
    const waiting = view(game, bob.token, null, settings, 3000);
    expect(waiting.myResponse).toBeUndefined(); expect(waiting.distribution).toBeUndefined(); expect(waiting.otherCount).toBeUndefined();
    expect(JSON.stringify(view(game, '', 'owner', settings, 3000, true))).not.toContain('Private Alice feedback');
    answer(game, bob.token, null, settings, 0, { options: [2] }, 3100);
    const host = view(game, '', 'owner', settings, 3100, true);
    expect(host).toMatchObject({ answerCount: 2, distribution: [1, 0, 2], otherCount: 1 });
    for (const projection of [host, view(game, bob.token, null, settings, 3100), preview(game, null, settings)]) {
      expect(JSON.stringify(projection)).not.toContain('Private Alice feedback');
      expect(JSON.stringify(projection)).not.toContain('survey-v1');
      expect(JSON.stringify(projection)).not.toContain('participantId');
    }
    expect(host.correctIndex).toBeUndefined(); expect(host.myResult).toBeUndefined();
  });
  it('keeps guest config/epoch, closed-question and quiz scoring boundaries', () => {
    const { game, alice } = fixture();
    const response: SurveyResponse = { options: [], other: 'Text' };
    for (const revoked of [{ ...settings, anonymousEnabled: false }, { ...settings, guestEpoch: 8 }]) {
      expect(() => answer(game, alice.token, null, revoked, 0, response, 3000)).toThrow();
    }
    expect(() => answer(game, alice.token, null, settings, 0, response, 62000)).toThrow('closed');
    const quiz = createGame({ ...draft, mode: 'quiz', questions: [{ ...question, survey: undefined, correctIndex: 0 }] }, 'owner', settings, 1000);
    const attendee = join(quiz, 'Quiz attendee', null, settings, 1000);
    control(quiz, 'start', quiz.version, 'owner', 2000);
    expect(() => answer(quiz, attendee.token, null, settings, 0, { options: [0] }, 3000)).toThrow();
    answer(quiz, attendee.token, null, settings, 0, 0, 3000);
    expect(quiz.answers[0].option).toBe(0);
    expect(quiz.answers[0].format).toBeUndefined();
    expect(quiz.participants[0].score).toBe(1492);
  });
});
