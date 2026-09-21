const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

const targets = [
  { name: 'Playwright test results (test-results/)', path: path.join(rootDir, 'test-results') },
  { name: 'Playwright HTML report (playwright-report/)', path: path.join(rootDir, 'playwright-report') },
  { name: 'Blob reports (blob-report/)', path: path.join(rootDir, 'blob-report') },
  { name: 'Playwright cache (.cache/)', path: path.join(rootDir, 'playwright', '.cache') },
  { name: 'Temporary Chrome profile (/tmp/railway-chrome-user-data)', path: '/tmp/railway-chrome-user-data' },
];

console.log('🧹 Clearing previous work, test artifacts, and session cache...\n');

let cleanedCount = 0;

for (const target of targets) {
  if (fs.existsSync(target.path)) {
    try {
      fs.rmSync(target.path, { recursive: true, force: true });
      console.log(`  ✅ Removed ${target.name}`);
      cleanedCount++;
    } catch (err) {
      console.warn(`  ⚠️ Could not remove ${target.name}: ${err.message}`);
    }
  } else {
    console.log(`  ⚪ Already clean: ${target.name}`);
  }
}

// Clean any root log files
try {
  const files = fs.readdirSync(rootDir);
  for (const file of files) {
    if (file.endsWith('.log')) {
      fs.unlinkSync(path.join(rootDir, file));
      console.log(`  ✅ Removed log file: ${file}`);
      cleanedCount++;
    }
  }
} catch {
  // ignore
}

console.log(`\n✨ Successfully cleared previous work (${cleanedCount} items cleaned).`);
console.log('💡 Ready for a fresh test suite run ("npm test") or fresh seat booking ("npm run book:middle").');
