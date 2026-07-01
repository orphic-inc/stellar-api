import type { Prisma } from '@prisma/client';
import type { AddContributionToReleaseInput } from '../../schemas/contribution';

export type ReleaseWorkbenchRef = {
  actorId: number;
  communityId: number;
  releaseId: number;
  permissions?: Record<string, boolean>;
};

export type ReleaseTagView = {
  id: number;
  tagId: number;
  name: string;
  occurrences: number;
  score: number;
  positiveVotes: number;
  negativeVotes: number;
  addedBy: { id: number; username: string } | null;
  createdAt: Date | null;
  myVotes: { up: boolean; down: boolean };
};

export type ReleaseContributionView = {
  id: number;
  userId: number;
  releaseId: number;
  contributorId: number;
  releaseDescription: string | null;
  sizeInBytes: number | null;
  approvedAccountingBytes: bigint | null;
  linkStatus: string | null;
  linkCheckedAt: Date | null;
  type: string;
  createdAt: Date;
  updatedAt: Date;
  user: { id: number; username: string } | null;
  release: { id: number; title: string; communityId: number | null };
  collaborators: Array<{ id: number; name: string }>;
};

// A release-scoped contribution read that nests the rip-quality satellite
// (ReleaseFile) and the full Edition identity alongside the spine — the shape
// the release detail view deliberately omits (see listReleaseContributions).
export type ReleaseContributionDetailView = {
  id: number;
  userId: number;
  releaseId: number;
  contributorId: number;
  releaseDescription: string | null;
  downloadUrl: string;
  sizeInBytes: number | null;
  linkStatus: string | null;
  linkCheckedAt: Date | null;
  type: string;
  createdAt: Date;
  updatedAt: Date;
  user: { id: number; username: string } | null;
  collaborators: Array<{ id: number; name: string }>;
  releaseFile: {
    bitrate: string | null;
    hasLog: boolean;
    hasCue: boolean;
    isScene: boolean;
  } | null;
  edition: {
    id: number;
    media: string | null;
    year: number | null;
    recordLabel: string | null;
    catalogueNumber: string | null;
    title: string | null;
    isRemaster: boolean;
    isUnknownEdition: boolean;
  };
};

export type ReleaseHistoryEntry = Prisma.ReleaseHistoryGetPayload<{
  include: { actor: { select: { id: true; username: true } } };
}>;

export type ReleaseHistoryPage = {
  data: ReleaseHistoryEntry[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type ReleaseWorkbenchView = {
  release: Prisma.ReleaseGetPayload<{
    include: {
      credits: {
        select: { role: true; artist: { select: { id: true; name: true } } };
      };
      voteAggregate: true;
      contributions: {
        select: {
          id: true;
          userId: true;
          releaseId: true;
          contributorId: true;
          releaseDescription: true;
          sizeInBytes: true;
          approvedAccountingBytes: true;
          linkStatus: true;
          linkCheckedAt: true;
          type: true;
          createdAt: true;
          updatedAt: true;
          user: { select: { id: true; username: true } };
          collaborators: true;
        };
      };
    };
  }>;
  tags: Array<{ id: number; name: string; occurrences: number }>;
  myVote: 'up' | 'down' | null;
  releaseTags: ReleaseTagView[];
  isContributor: boolean;
  permissions: {
    canEditMetadata: boolean;
    canManageTags: boolean;
    canVote: boolean;
    canAttachContribution: boolean;
    canRevertHistory: boolean;
  };
};

export type UpdateReleaseMetadataInput = {
  title?: string;
  description?: string;
  image?: string;
  year?: number;
  editSummary?: string;
};

export type ReleaseWorkbenchSession = {
  getView(): Promise<ReleaseWorkbenchView>;
  getHistoryPage(input: {
    page?: number;
    limit?: number;
  }): Promise<ReleaseHistoryPage>;
  updateMetadata(
    input: UpdateReleaseMetadataInput
  ): Promise<ReleaseWorkbenchView>;
  vote(input: {
    direction: 'up' | 'down' | 'clear';
  }): Promise<ReleaseWorkbenchView>;
  addTag(input: { name: string }): Promise<ReleaseWorkbenchView>;
  voteTag(input: {
    tagId: number;
    direction: 'up' | 'down';
  }): Promise<ReleaseTagView>;
  removeTag(input: { tagId: number }): Promise<ReleaseWorkbenchView>;
  attachContribution(
    input: AddContributionToReleaseInput
  ): Promise<ReleaseContributionView>;
  listContributions(): Promise<ReleaseContributionDetailView[]>;
  revertHistory(input: { historyId: number }): Promise<ReleaseWorkbenchView>;
};

export type ReleaseWorkbenchModule = {
  open(ref: ReleaseWorkbenchRef): Promise<ReleaseWorkbenchSession>;
};
