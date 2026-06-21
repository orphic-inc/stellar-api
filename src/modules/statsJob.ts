import { getLogger } from './logging';
import { captureUserStats, captureSiteStats } from './statsHistory';
import { captureCommunityHealth } from './communityHealthHistory';
import { captureCrsSnapshots } from './crsHistory';

const log = getLogger('statsJob');

const HOURLY_MS = 60 * 60 * 1000;
const DAILY_MS = 24 * 60 * 60 * 1000;
const WEEKLY_MS = 7 * 24 * 60 * 60 * 1000;

export const startStatsJob = (): void => {
  // Daily period: captured hourly, 25h retention
  const runHourly = () =>
    Promise.all([
      captureUserStats('Daily'),
      captureSiteStats(),
      captureCommunityHealth('Daily')
      // CRS is intentionally not captured hourly — it moves on a multi-day
      // scale, so it's snapshotted only on the daily/weekly cascades (#94).
    ]).catch((err) => log.error('Hourly stats capture failed', { err }));
  const hourlyDelay = setTimeout(() => {
    runHourly();
    setInterval(runHourly, HOURLY_MS).unref();
  }, 60_000);
  hourlyDelay.unref();

  // Monthly period: captured daily, 32d retention
  const runDaily = () =>
    Promise.all([
      captureUserStats('Monthly'),
      captureCommunityHealth('Monthly'),
      captureCrsSnapshots('Monthly')
    ]).catch((err) => log.error('Daily stats capture failed', { err }));
  const dailyDelay = setTimeout(() => {
    runDaily();
    setInterval(runDaily, DAILY_MS).unref();
  }, 90_000);
  dailyDelay.unref();

  // Yearly period: captured weekly, 53w retention
  const runWeekly = () =>
    Promise.all([
      captureUserStats('Yearly'),
      captureCommunityHealth('Yearly'),
      captureCrsSnapshots('Yearly')
    ]).catch((err) => log.error('Weekly stats capture failed', { err }));
  const weeklyDelay = setTimeout(() => {
    runWeekly();
    setInterval(runWeekly, WEEKLY_MS).unref();
  }, 120_000);
  weeklyDelay.unref();

  log.info('Stats snapshot job scheduled');
};
