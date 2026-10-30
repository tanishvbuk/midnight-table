import { expect, it } from 'vitest';
import { ENGINE_VERSION } from '../src/index';

it('loads', () => {
  expect(ENGINE_VERSION).toBe(1);
});
