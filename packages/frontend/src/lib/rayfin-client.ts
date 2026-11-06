import { RayfinClient, resolveRayfinConfig } from '@microsoft/rayfin-client';
import { ensureSignedInWithFabric, initEmbeddedAuth } from '@microsoft/rayfin-auth-provider-fabric';
import type { UniversalAppSchema } from '@rayfin-app/shared';
import type { AppFunctionsSchema } from '../../../../rayfin/functions/src/types';

export async function connect() {
  const resolved = await resolveRayfinConfig({
    apiUrl: import.meta.env.VITE_RAYFIN_API_URL,
    publishableKey: import.meta.env.VITE_RAYFIN_PUBLISHABLE_KEY,
    workspaceId: import.meta.env.VITE_FABRIC_WORKSPACE_ID,
    itemId: import.meta.env.VITE_FABRIC_ITEM_ID,
    portalUrl: import.meta.env.VITE_FABRIC_PORTAL_URL,
  });
  if (!resolved.baseUrl || !resolved.publishableKey) {
    throw new Error('Not configured yet. Follow docs/deployment.md and supply the Fabric runtime configuration.');
  }
  const client = new RayfinClient<UniversalAppSchema, AppFunctionsSchema>({
    baseUrl: resolved.baseUrl, publishableKey: resolved.publishableKey,
    runtimeConfig: resolved.runtimeConfig, authStorage: true,
  });
  const options = {
    workspaceId: resolved.runtimeConfig.workspaceId ?? '',
    projectId: resolved.runtimeConfig.itemId ?? '',
    fabricPortalUrl: resolved.runtimeConfig.portalUrl ?? '',
    returnOrigin: window.location.origin,
  };
  await initEmbeddedAuth(client.auth, options);
  return {
    client,
    signIn: () => ensureSignedInWithFabric(client.auth, options),
    async identity(): Promise<string> {
      const session = client.auth.getSession();
      if (!session.isAuthenticated || session.isAnonymous || !session.user) return '';
      const subject = session.user.id;
      const rows = await client.data.CallerIdentity.select(['subject'])
        .where({ subject: { eq: subject } }).first(1).execute();
      if (!rows.length) await client.data.CallerIdentity.create({ subject });
      return subject;
    },
  };
}
export type Connection = Awaited<ReturnType<typeof connect>>;
export async function call<T>(
  connection: Connection, request: Record<string, unknown>, token = '', asGuest = false,
): Promise<T> {
  const subject = asGuest ? '' : await connection.identity();
  const reply = await connection.client.functions.quizcrowd.invoke({
    request: JSON.stringify(request), subject, attendeeToken: token,
  });
  if (!reply.ok) throw new Error(reply.error ?? 'QuizCrowd request failed.');
  return JSON.parse(reply.value) as T;
}
