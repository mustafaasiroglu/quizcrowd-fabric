import { z } from 'zod';
import { copyTitle, getAnswerDuration, MAX_OPTIONS, MAX_SURVEY_TEXT_LENGTH } from '@rayfin-app/shared';
import type { Store } from './sql-store.js';
import {
  answer, control, createGame, Denied, Conflict, draftSchema, join, own, preview,
  settingsView, signed, view, visibilityAllowed, authorDraft, guestAllowed, readOnly, summary, surveyWrittenPage,
} from './domain.js';

const requestSchema = z.object({
  command: z.enum(['settings', 'configure', 'list', 'create', 'edit', 'duplicate', 'resolve', 'visibility', 'delete', 'preview', 'join', 'state', 'host', 'answer', 'control', 'written']),
  id: z.string().regex(/^(?:[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}|[0-9A-F]{10}|[0-9]{6})$/i).optional(),
  nickname: z.string().optional(),
  enabled: z.boolean().optional(),
  visibility: z.enum(['internal', 'public']).optional(),
  publicAcknowledged: z.boolean().optional(),
  version: z.number().int().nonnegative().optional(),
  action: z.enum(['start', 'next']).optional(),
  questionIndex: z.number().int().min(0).max(39).optional(),
  offset: z.number().int().min(0).max(499).optional(),
  option: z.number().int().min(0).max(MAX_OPTIONS - 1).optional(),
  response: z.object({ options: z.array(z.number().int().min(0).max(MAX_OPTIONS - 1)).max(MAX_OPTIONS), other: z.string().max(MAX_SURVEY_TEXT_LENGTH).optional() }).strict().optional(),
  draft: draftSchema.optional(),
}).strict();

export async function execute(
  store: Store, raw: unknown, subject: string | null, token: string, now = Date.now(),
): Promise<unknown> {
  const input = requestSchema.parse(raw);
  return store.transact(async (tx) => {
    // Every command, including an old guest token, rechecks this row in the same
    // transaction as the game operation. No TTL cache can outlive revocation.
    const settings = await tx.settings();
    if (input.command === 'settings') {
      return settingsView(settings, !!subject && await tx.isAdmin(subject));
    }
    if (input.command === 'configure') {
      const actor = signed(subject);
      if (!await tx.isAdmin(actor)) throw new Denied('An authorized administrator is required.');
      if (input.enabled === undefined) throw new Conflict('Specify enabled.');
      return settingsView(await tx.setAnonymous(actor, input.enabled), true);
    }
    if (input.command === 'list') {
      return (await tx.list(signed(subject))).map(summary);
    }
    if (input.command === 'create') {
      const game = createGame(input.draft, subject, settings, now);
      await tx.save(game, true);
      return { id: game.id, code: game.code };
    }
    if (!input.id) throw new Conflict('A quiz ID or join code is required.');
    const game = await tx.get(input.id);
    if (!game) throw new Denied('Quiz is unavailable.');
    let result: unknown;
    switch (input.command) {
      case 'resolve':
        if (!subject) guestAllowed(game, settings);
        return { code: game.code };
      case 'duplicate': {
        own(game, subject);
        const draft = { ...authorDraft(game), title: copyTitle(game.title), visibility: 'internal' as const, publicAcknowledged: false };
        const copy = createGame(draft, subject, settings, now);
        await tx.save(copy, true);
        return { id: copy.id, code: copy.code };
      }
      case 'preview': return preview(game, subject, settings);
      case 'visibility': {
        own(game, subject);
        if (!input.visibility) throw new Conflict('Choose an audience.');
        if (readOnly(game) && input.visibility !== 'internal') throw new Conflict('This session is read-only. Public access can only be revoked.');
        const change = {
          ...game, visibility: input.visibility,
          publicAcknowledged: input.publicAcknowledged === true,
        };
        visibilityAllowed(change, settings);
        game.visibility = change.visibility;
        game.publicAcknowledged = change.publicAcknowledged;
        game.version++;
        result = { updated: true };
        break;
      }
      case 'edit': {
        own(game, subject);
        if (!input.draft) return { ...summary(game), draft: authorDraft(game) };
        if (readOnly(game)) throw new Conflict('Started sessions and sessions with responses are read-only. Duplicate this session to edit a new copy.');
        if (input.draft.mode !== game.mode) throw new Conflict('Content type cannot be changed. Create a new quiz or survey instead.');
        const draft = draftSchema.parse({ ...input.draft,
          answerDuration: input.draft.answerDuration ?? game.answerDuration ?? getAnswerDuration(input.draft) });
        visibilityAllowed(draft, settings);
        Object.assign(game, draft);
        game.version++;
        result = { id: game.id };
        break;
      }
      case 'delete':
        own(game, subject);
        await tx.remove(game.id);
        return { deleted: true };
      case 'join': result = join(game, input.nickname, subject, settings, now); break;
      case 'state': result = view(game, token, subject, settings, now); break;
      case 'host': result = view(game, '', subject, settings, now, true); break;
      case 'written':
        if (input.questionIndex === undefined || input.offset === undefined) throw new Conflict('Specify a question and written-response offset.');
        return surveyWrittenPage(game, subject, input.questionIndex, input.offset);
      case 'answer':
        if (input.questionIndex === undefined || (input.option === undefined) === (input.response === undefined)) {
          throw new Conflict('Specify a question and exactly one answer payload.');
        }
        result = answer(game, token, subject, settings, input.questionIndex, input.response ?? input.option!, now);
        break;
      case 'control':
        if (input.version === undefined || !input.action) throw new Conflict('Host version and action are required.');
        control(game, input.action, input.version, subject, now);
        result = { updated: true };
        break;
    }
    await tx.save(game);
    return result;
  });
}
