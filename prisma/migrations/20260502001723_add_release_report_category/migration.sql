-- CreateEnum
CREATE TYPE "ReleaseReportCategory" AS ENUM ('Dupe', 'Trump', 'BadFileNamesTrump', 'BadFolderNameTrump', 'TagTrump', 'VinylTrump', 'AudienceRecording', 'BadFileNames', 'BadFolderNames', 'BadTagNoTag', 'BonusTracksOnly', 'DisallowedFormat', 'DiscsMissing', 'Discography', 'MqaBanned', 'EditedLog', 'InaccurateBitrate', 'LogRescoreRequest', 'LossyMasterApprovalRequest', 'ContributionContestApprovalRequest', 'LowBitrate', 'MuttRip', 'NoLineageInfo', 'Other', 'RadioTvFmWebRip', 'SkipsEncodeErrors', 'SpecificallyBanned', 'TracksMissing', 'Transcode', 'UnsplitAlbumRip', 'Urgent', 'UserCompilation', 'WrongSpecifiedFormat', 'WrongSpecifiedMedia');

-- AlterTable
ALTER TABLE "reports" ADD COLUMN     "releaseCategory" "ReleaseReportCategory";
