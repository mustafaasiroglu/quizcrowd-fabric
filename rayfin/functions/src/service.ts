import { z } from 'zod';
import type { Store } from './sql-store.js';
import {
  answer, control, createGame, Denied, Conflict, draftSchema, join, own, preview,
  settingsView, signed, view, visibilityAllowed,
} from './domain.js';

const requestSchema = z.object({
  command: z.enum(['settings', 'configure', 'list', 'create', 'edit', 'visibility', 'delete', 'preview', 'join', 'state', 'host', 'answer', 'control']),
  id: z.string().regex(/^(?:[0-9a-f-]{36}|[0-9A-F]{10})$/i).optional(),
  nickname: z.string().optional(),
  enabled: z.boolean().optional(),
  visibility: z.enum(['internal', 'public']).optional(),
  publicAcknowledged: z.boolean().optional(),
  version: z.number().int().nonnegative().optional(),
  action: z.enum(['start', 'next']).optional(),
  questionIndex: z.number().int().min(0).max(39).optional(),
  option: z.number().int().min(0).max(5).optional(),
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
      return (await tx.list(signed(subject))).map(({ id, code, title, phase, visibility }) =>
        ({ id, code, title, phase, visibility }));
    }
    if (input.command === 'create') {
      const game = createGame(input.draft, subject, settings, now);
      await tx.save(game, true);
      return { id: game.id };
    }
    if (!input.id) throw new Conflict('A quiz ID or join code is required.');
    const game = await tx.get(input.id);
    if (!game) throw new Denied('Quiz is unavailable.');
    let result: unknown;
    switch (input.command) {
      case 'preview': return preview(game, subject, settings);
      case 'visibility': {
        own(game, subject);
        if (!input.visibility) throw new Conflict('Choose an audience.');
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
      case 'edit':
        own(game, subject);
        if (!input.draft) return {
          title: game.title, mode: game.mode, visibility: game.visibility,
          publicAcknowledged: game.publicAcknowledged, lateJoin: game.lateJoin,
          showAnswer: game.showAnswer, questions: game.questions,
        };
        visibilityAllowed(input.draft, settings);
        if (game.phase !== 'lobby' || game.participants.length) throw new Conflict('Only an empty lobby can be edited. Duplicate it instead.');
        Object.assign(game, input.draft);
        game.version++;
        result = { id: game.id };
        break;
      case 'delete':
        own(game, subject);
        await tx.remove(game.id);
        return { deleted: true };
      case 'join': result = join(game, input.nickname, subject, settings, now); break;
      case 'state': result = view(game, token, subject, settings, now); break;
      case 'host': result = view(game, '', subject, settings, now, true); break;
      case 'answer':
        if (input.questionIndex === undefined || input.option === undefined) throw new Conflict('Select an option and question.');
        result = answer(game, token, subject, settings, input.questionIndex, input.option, now);
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
