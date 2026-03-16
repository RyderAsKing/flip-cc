import chalk from 'chalk';
import { getSessions, clearStats } from '../lib/stats.js';
import type { SessionRecord } from '../types.js';

/**
 * Format milliseconds into a human-readable duration string.
 */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Format a date string for display.
 */
function formatDate(iso: string): string {
  const d = new Date(iso);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

/**
 * Get provider display name.
 */
function providerDisplay(provider: string): string {
  switch (provider) {
    case 'anthropic': return 'Anthropic';
    case 'kimi': return 'Kimi';
    case 'openrouter': return 'OpenRouter';
    case 'openai-compatible': return 'OpenAI-compatible';
    default: return provider;
  }
}

export interface StatsOptions {
  clear?: boolean;
}

/**
 * Show session statistics or clear them.
 */
export async function statsCommand(profileId?: string, options?: StatsOptions): Promise<void> {
  if (options?.clear) {
    clearStats(profileId);
    if (profileId) {
      console.log(chalk.green(`  Statistics cleared for profile "${profileId}".`));
    } else {
      console.log(chalk.green('  All statistics cleared.'));
    }
    return;
  }

  const sessions = getSessions(profileId);

  if (sessions.length === 0) {
    if (profileId) {
      console.log(chalk.yellow(`No sessions recorded for profile "${profileId}".`));
    } else {
      console.log(chalk.yellow('No sessions recorded yet. Launch a profile to start tracking.'));
    }
    return;
  }

  // Group sessions by profile
  const byProfile = new Map<string, SessionRecord[]>();
  for (const session of sessions) {
    const existing = byProfile.get(session.profileId) || [];
    existing.push(session);
    byProfile.set(session.profileId, existing);
  }

  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  console.log(chalk.bold('\nSession Statistics (last 30 days)\n'));

  for (const [id, profileSessions] of byProfile) {
    const last = profileSessions[profileSessions.length - 1]!;
    const provider = last.provider;
    const displayName = last.profileName || id;

    const recent = profileSessions.filter(
      (s) => now - new Date(s.startedAt).getTime() < thirtyDaysMs,
    );

    const totalTimeAll = profileSessions.reduce((sum, s) => sum + s.durationMs, 0);
    const totalTime30d = recent.reduce((sum, s) => sum + s.durationMs, 0);
    const avgSession = Math.round(totalTimeAll / profileSessions.length);

    console.log(`  ${chalk.cyan(displayName)}`);
    console.log(`    Provider:        ${providerDisplay(provider)}`);
    console.log(`    Sessions (30d):  ${recent.length}`);
    console.log(`    Time (30d):      ${formatDuration(totalTime30d)}`);
    console.log(`    Total time:      ${formatDuration(totalTimeAll)}`);
    console.log(`    Avg session:     ${formatDuration(avgSession)}`);
    console.log(`    Last session:    ${formatDate(last.endedAt)}`);
    console.log('');
  }
}
