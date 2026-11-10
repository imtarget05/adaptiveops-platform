/**
 * AdaptiveOps E2E Test Suite - Logger & Diagnostic Reporter
 */

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

export class Logger {
  static info(msg) {
    console.log(`${colors.cyan}[INFO]${colors.reset} ${msg}`);
  }

  static success(msg) {
    console.log(`${colors.green}[PASS]${colors.reset} ${msg}`);
  }

  static warn(msg) {
    console.log(`${colors.yellow}[WARN]${colors.reset} ${msg}`);
  }

  static error(msg) {
    console.error(`${colors.red}[FAIL]${colors.reset} ${msg}`);
  }

  static section(title) {
    const bar = '━'.repeat(72);
    console.log(`\n${colors.magenta}${bar}${colors.reset}`);
    console.log(`${colors.bright}${colors.cyan}  ${title}${colors.reset}`);
    console.log(`${colors.magenta}${bar}${colors.reset}\n`);
  }

  static suiteHeader(suiteName, description = '') {
    console.log(`\n${colors.bright}${colors.blue}▶ Suite:${colors.reset} ${colors.bright}${suiteName}${colors.reset}`);
    if (description) {
      console.log(`  ${colors.dim}${description}${colors.reset}`);
    }
  }

  static testPass(testName, durationMs) {
    const timeStr = durationMs !== undefined ? `${colors.gray}(${durationMs}ms)${colors.reset}` : '';
    console.log(`  ${colors.green}✔${colors.reset} ${testName} ${timeStr}`);
  }

  static testFail(testName, error, durationMs) {
    const timeStr = durationMs !== undefined ? `${colors.gray}(${durationMs}ms)${colors.reset}` : '';
    console.error(`  ${colors.red}✖${colors.reset} ${testName} ${timeStr}`);
    if (error && error.message) {
      console.error(`    ${colors.red}Error: ${error.message}${colors.reset}`);
      if (error.expected !== undefined && error.actual !== undefined) {
        console.error(`    ${colors.yellow}Expected:${colors.reset} ${JSON.stringify(error.expected)}`);
        console.error(`    ${colors.yellow}Actual:  ${colors.reset} ${JSON.stringify(error.actual)}`);
      }
      if (error.stack && process.env.DEBUG) {
        console.error(`    ${colors.dim}${error.stack}${colors.reset}`);
      }
    }
  }

  static summaryTable(stats) {
    const total = stats.passed + stats.failed + stats.skipped;
    console.log(`\n${colors.bright}══════════════════════════════════════════════════════════════════════${colors.reset}`);
    console.log(`${colors.bright}                 AdaptiveOps E2E Test Suite Summary                   ${colors.reset}`);
    console.log(`${colors.bright}══════════════════════════════════════════════════════════════════════${colors.reset}`);
    console.log(`  Total Suites:    ${stats.suites}`);
    console.log(`  Total Tests:     ${total}`);
    console.log(`  ${colors.green}Passed:${colors.reset}          ${stats.passed}`);
    console.log(`  ${colors.red}Failed:${colors.reset}          ${stats.failed}`);
    if (stats.skipped > 0) {
      console.log(`  ${colors.yellow}Skipped:${colors.reset}         ${stats.skipped}`);
    }
    console.log(`  Duration:        ${(stats.durationMs / 1000).toFixed(2)}s`);
    console.log(`${colors.bright}══════════════════════════════════════════════════════════════════════${colors.reset}`);
    if (stats.failed === 0) {
      console.log(`${colors.bright}${colors.green}  STATUS: 100% PASS - ALL QUALITY GATES VERIFIED${colors.reset}\n`);
    } else {
      console.log(`${colors.bright}${colors.red}  STATUS: FAILED - ${stats.failed} TEST(S) FAILED${colors.reset}\n`);
    }
  }
}
