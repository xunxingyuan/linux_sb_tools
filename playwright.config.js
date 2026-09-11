const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './browser-tests', timeout: 35000, workers: 1,
  reporter: 'list', outputDir: 'test-results',
  use: { trace: 'retain-on-failure' }
});
