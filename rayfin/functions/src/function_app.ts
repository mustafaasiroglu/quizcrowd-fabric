import { AudienceType, UserDataFunctions, type RayfinContext } from '@microsoft/fabric-user-data-functions';
import type { UniversalAppSchema } from '@rayfin-app/shared';
import { z } from 'zod';
import { Denied, Conflict } from './domain.js';
import { execute } from './service.js';
import { SqlStore } from './sql-store.js';
import { sqlConfiguration } from './deployment.js';
import { verifyCaller } from './identity.js';

const udf = new UserDataFunctions();
udf.func('quizcrowd', async (
  request: string,
  subject: string,
  attendeeToken: string,
  ctx: RayfinContext<UniversalAppSchema, AudienceType.Sql>,
): Promise<{ ok: boolean; value: string; error: string }> => {
  try {
    if (request.length > 150000 || subject.length > 255 || attendeeToken.length > 128) {
      throw new Conflict('Request is too large.');
    }
    const authenticated = await verifyCaller(subject, !!ctx.accessToken, () =>
      ctx.getDataClient().CallerIdentity.select(['subject'])
        .where({ subject: { eq: subject } }).first(1).execute());
    const { server, database } = sqlConfiguration(ctx.Secrets.QUIZCROWD_SQL_SERVER, ctx.Secrets.QUIZCROWD_SQL_DATABASE);
    const store = new SqlStore(server, database, ctx.Tokens.Sql);
    const output = await execute(store, JSON.parse(request) as unknown, authenticated, attendeeToken);
    return { ok: true, value: JSON.stringify(output), error: '' };
  } catch (error) {
    if (error instanceof Denied || error instanceof Conflict || error instanceof z.ZodError || error instanceof SyntaxError) {
      console.warn('QuizCrowd request denied', error.name);
      return { ok: false, value: '', error: error instanceof z.ZodError ? 'Invalid quiz or request fields.' : error.message };
    }
    console.error('QuizCrowd request failed', error);
    throw new Error('QuizCrowd service failed. Contact the publisher and check the function logs.');
  }
}, []);
