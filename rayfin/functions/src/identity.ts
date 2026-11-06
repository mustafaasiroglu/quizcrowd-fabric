import { Denied } from './domain.js';

export async function verifyCaller(
  claimedSubject: string,
  hasInvocationToken: boolean,
  lookup: () => Promise<readonly { subject: string }[]>,
): Promise<string | null> {
  if (!claimedSubject) return null;
  if (!hasInvocationToken) throw new Denied('Microsoft Entra sign-in is required.');
  // lookup must use the invocation-scoped DAB client, never app-identity SQL.
  const rows = await lookup();
  if (rows.length !== 1 || rows[0].subject !== claimedSubject) {
    throw new Denied('Caller identity could not be verified.');
  }
  return claimedSubject;
}
