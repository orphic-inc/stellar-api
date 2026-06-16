import { getLogger } from './logging';
import { captureUserStats, captureSiteStats } from './statsHistory';
import { captureCommunityHealth } from './communityHealthHistory';

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
      captureCommunityHealth('Monthly')
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
      captureCommunityHealth('Yearly')
    ]).catch((err) => log.error('Weekly stats capture failed', { err }));
  const weeklyDelay = setTimeout(() => {
    runWeekly();
    setInterval(runWeekly, WEEKLY_MS).unref();
  }, 120_000);
  weeklyDelay.unref();

  log.info('Stats snapshot job scheduled');
};
