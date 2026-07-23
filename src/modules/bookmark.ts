import { DownloadGrantStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';

// Bulk-clear the caller's release bookmarks they've already consumed (#296).
// "Consumed" = the caller holds a live (COMPLETED) DownloadAccessGrant on any
// contribution under the release. A release fans out to many contributions
// (editions/rips), so a single grab clears the bookmark. REVERSED grants don't
// count — a claw-back flips the status, so the queue entry stays. Freepass /
// Neutralpass grants stay COMPLETED and do count; the member still downloaded it.
export async function removeConsumedReleaseBookmarks(
  userId: number
): Promise<number> {
  const { count } = await prisma.bookmarkRelease.deleteMany({
    where: {
      userId,
      release: {
        contributions: {
          some: {
            downloadAccessGrants: {
              some: {
                consumerId: userId,
                status: DownloadGrantStatus.COMPLETED
              }
            }
          }
        }
      }
    }
  });
  return count;
}
