import { afterEach, describe, expect, it, vi } from 'vitest';
import { RayfinClient } from '@microsoft/rayfin-client';
import type { UniversalAppSchema } from '../packages/shared/src/index';
import type { AppFunctionsSchema } from '../rayfin/functions/src/types';

afterEach(() => vi.unstubAllGlobals());
describe('real SDK Function wire behavior with mocked HTTP', () => {
  for (const encoded of [false, true]) {
    it(`preserves the typed reply envelope (wire JSON string: ${encoded})`, async () => {
      const reply = { ok: true, value: JSON.stringify({ anonymousEnabled: false }), error: '' };
      const http = vi.fn(async () => new Response(JSON.stringify({
        status: 'Succeeded', output: encoded ? JSON.stringify({ output: reply }) : reply,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      vi.stubGlobal('fetch', http);
      const client = new RayfinClient<UniversalAppSchema, AppFunctionsSchema>({
        baseUrl: 'https://quizcrowd-test.invalid', publishableKey: 'pk-test-not-a-secret',
        authStorage: false, autoRefreshToken: false, multiTabSync: false,
      });
      try {
        const result = await client.functions.quizcrowd.invoke({
          request: '{"command":"settings"}', subject: '', attendeeToken: '',
        });
        expect(result).toEqual(reply);
        expect(JSON.parse(result.value)).toEqual({ anonymousEnabled: false });
        expect(http).toHaveBeenCalledOnce();
        const args: unknown[] = http.mock.calls[0];
        expect(String(args[0])).toContain('/functions/quizcrowd/invoke');
      } finally { client.auth.destroy(); }
    });
  }
});
