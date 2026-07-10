import { test } from '@playwright/test';

test('tarda mucho', async () => {
  await new Promise((resolve) => setTimeout(resolve, 60_000));
});
