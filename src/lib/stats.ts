import Conf from 'conf';
import type { SessionRecord, StatsData } from '../types.js';

const MAX_SESSIONS = 200;

const statsStore = new Conf<StatsData>({
  projectName: 'flip-cc',
  configName: 'stats',
  defaults: {
    sessions: [],
  },
});

/**
 * Add a session record and prune to the last MAX_SESSIONS entries.
 */
export function addSession(record: SessionRecord): void {
  const sessions = statsStore.get('sessions');
  sessions.push(record);
  if (sessions.length > MAX_SESSIONS) {
    sessions.splice(0, sessions.length - MAX_SESSIONS);
  }
  statsStore.set('sessions', sessions);
}

/**
 * Get all sessions, optionally filtered by profile ID.
 */
export function getSessions(profileId?: string): SessionRecord[] {
  const sessions = statsStore.get('sessions');
  if (profileId) {
    return sessions.filter((s) => s.profileId === profileId);
  }
  return sessions;
}

/**
 * Clear all sessions or sessions for a specific profile.
 */
export function clearStats(profileId?: string): void {
  if (profileId) {
    const sessions = statsStore.get('sessions');
    statsStore.set(
      'sessions',
      sessions.filter((s) => s.profileId !== profileId),
    );
  } else {
    statsStore.set('sessions', []);
  }
}
