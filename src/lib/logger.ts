import chalk from 'chalk';

const DEBUG = process.env.FLIP_CC_DEBUG === '1';

export function debug(context: string, ...args: unknown[]) {
  if (DEBUG) console.error(chalk.gray(`[debug:${context}]`), ...args);
}

export function warn(context: string, ...args: unknown[]) {
  console.warn(chalk.yellow(`[${context}]`), ...args);
}
