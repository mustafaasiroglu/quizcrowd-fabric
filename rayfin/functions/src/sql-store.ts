import sql from 'mssql';
import type { Game, Settings } from './domain.js';

export interface UnitOfWork {
  settings(): Promise<Settings>;
  isAdmin(subject: string): Promise<boolean>;
  setAnonymous(subject: string, enabled: boolean): Promise<Settings>;
  get(idOrCode: string): Promise<Game | null>;
  save(game: Game, create?: boolean): Promise<void>;
  remove(id: string): Promise<void>;
  list(subject: string): Promise<Game[]>;
}
export interface Store {
  transact<T>(work: (tx: UnitOfWork) => Promise<T>): Promise<T>;
}
export class SqlStore implements Store {
  constructor(private readonly server: string, private readonly database: string, private readonly token: string) {}

  async transact<T>(work: (tx: UnitOfWork) => Promise<T>): Promise<T> {
    return retryJoinCode(() => this.attempt(work));
  }
  private async attempt<T>(work: (tx: UnitOfWork) => Promise<T>): Promise<T> {
    // A separate pool per invocation prevents token/identity reuse across requests.
    const pool = new sql.ConnectionPool({
      server: this.server, database: this.database,
      options: { encrypt: true, trustServerCertificate: false, abortTransactionOnError: true },
      authentication: { type: 'azure-active-directory-access-token', options: { token: this.token } },
      pool: { max: 1, min: 0, idleTimeoutMillis: 1000 },
      requestTimeout: 20000, connectionTimeout: 15000,
    });
    await pool.connect();
    const tx = new sql.Transaction(pool);
    let active = false;
    tx.on('rollback', () => { active = false; });
    try {
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      active = true;
      const request = () => new sql.Request(tx);
      const settings = async (): Promise<Settings> => {
        const result = await request().query<{ AnonymousEnabled: boolean; GuestEpoch: number }>(
          'SELECT AnonymousEnabled, GuestEpoch FROM quizcrowd.Settings WITH (HOLDLOCK) WHERE Id = 1');
        if (result.recordset.length !== 1) throw new Error('QuizCrowd settings row is missing.');
        return { anonymousEnabled: result.recordset[0].AnonymousEnabled, guestEpoch: result.recordset[0].GuestEpoch };
      };
      const uow: UnitOfWork = {
        settings,
        async isAdmin(subject) {
          const r = await request().input('subject', sql.NVarChar(255), subject)
            .query('SELECT Subject FROM quizcrowd.Administrators WHERE Subject = @subject');
          return r.recordset.length === 1;
        },
        async setAnonymous(subject, enabled) {
          await request().input('enabled', sql.Bit, enabled).query(
            'UPDATE quizcrowd.Settings SET AnonymousEnabled=@enabled, GuestEpoch=GuestEpoch+1 WHERE Id=1 AND AnonymousEnabled<>@enabled');
          const current = await settings();
          await request().input('subject', sql.NVarChar(255), subject)
            .input('enabled', sql.Bit, current.anonymousEnabled).input('epoch', sql.Int, current.guestEpoch)
            .query('INSERT quizcrowd.Audit (Actor, AnonymousEnabled, GuestEpoch) VALUES (@subject, @enabled, @epoch)');
          return current;
        },
        async get(idOrCode) {
          const r = await request().input('key', sql.NVarChar(36), idOrCode)
            .query<{ Document: string }>(
              'SELECT Document FROM quizcrowd.Games WITH (UPDLOCK,HOLDLOCK) WHERE Id=TRY_CONVERT(uniqueidentifier,@key) OR Code=@key OR LegacyCode=@key');
          return r.recordset.length ? JSON.parse(r.recordset[0].Document) as Game : null;
        },
        async save(game, create = false) {
          const r = request().input('id', sql.UniqueIdentifier, game.id)
            .input('code', sql.VarChar(10), game.code).input('owner', sql.NVarChar(255), game.owner)
            .input('document', sql.NVarChar(sql.MAX), JSON.stringify(game));
          if (create) await r.query('INSERT quizcrowd.Games (Id, Code, OwnerSubject, Document) VALUES (@id,@code,@owner,@document)');
          else await r.query('UPDATE quizcrowd.Games SET Document=@document WHERE Id=@id');
        },
        async remove(id) {
          await request().input('id', sql.UniqueIdentifier, id).query('DELETE quizcrowd.Games WHERE Id=@id');
        },
        async list(subject) {
          const r = await request().input('subject', sql.NVarChar(255), subject)
            .query<{ Document: string }>('SELECT TOP (100) Document FROM quizcrowd.Games WHERE OwnerSubject=@subject ORDER BY TRY_CONVERT(bigint,JSON_VALUE(Document,\'$.createdAt\')) DESC, Id');
          return r.recordset.map((row) => JSON.parse(row.Document) as Game);
        },
      };
      const result = await work(uow);
      await tx.commit();
      active = false;
      return result;
    } catch (error) {
      if (active) {
        try { await tx.rollback(); }
        catch (rollbackError) { console.error('QuizCrowd transaction rollback failed', rollbackError); }
      }
      throw error;
    } finally { await pool.close(); }
  }
}
export function isJoinCodeCollision(error: unknown): boolean {
  return error instanceof sql.RequestError && typeof error.number === 'number' && [2601, 2627].includes(error.number) &&
    error.message.includes('UQ_QuizCrowdCode');
}
export async function retryJoinCode<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await work(); }
    catch (error) {
      if (!isJoinCodeCollision(error) || attempt >= 5) throw error;
      console.warn('QuizCrowd join-code collision; retrying the rolled-back transaction', attempt + 1);
    }
  }
}
