import { describe, expect, it, vi } from 'vitest';
import { verifyCaller } from '../rayfin/functions/src/identity';

describe('Function caller verification (mocked DAB lookup)', () => {
  it('does not convert an anonymous request into a signed-in identity', async () => {
    const lookup = vi.fn();
    expect(await verifyCaller('', false, lookup)).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
    await expect(verifyCaller('owner', false, lookup)).rejects.toThrow('sign-in');
    expect(lookup).not.toHaveBeenCalled();
  });
  it('rejects forged subjects when DAB returns no matching caller-owned row', async () => {
    await expect(verifyCaller('owner', true, async () => [])).rejects.toThrow('verified');
    await expect(verifyCaller('owner', true, async () => [{ subject: 'attacker' }])).rejects.toThrow('verified');
    await expect(verifyCaller('owner', true, async () => [{ subject: 'owner' }, { subject: 'owner' }])).rejects.toThrow();
  });
  it('accepts only a lookup-verified subject and propagates DAB failures', async () => {
    expect(await verifyCaller('owner', true, async () => [{ subject: 'owner' }])).toBe('owner');
    await expect(verifyCaller('owner', true, async () => { throw new Error('DAB denied'); })).rejects.toThrow('DAB denied');
  });
});
