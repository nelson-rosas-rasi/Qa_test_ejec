import { test, expect } from '@playwright/test';

test.describe('operaciones', () => {
  test('resta', () => {
    expect(3 - 1).toBe(2);
  });

  test('falla a propósito', () => {
    expect(1).toBe(2);
  });

  test.skip('omitida', () => {
    expect(true).toBe(true);
  });
});
