import { CommentPage } from '@prisma/client';
import { z } from 'zod';

const commentPageEnum = z.enum(
  Object.values(CommentPage) as [CommentPage, ...CommentPage[]]
);

const pageIdSchema = z.number().int().positive();

export const commentQuerySchema = z.object({
  page: commentPageEnum.optional(),
  pageId: z.coerce.number().int().positive().optional()
});

export const createCommentSchema = z
  .object({
    page: commentPageEnum,
    body: z.string().min(1, 'Body is required'),
    communityId: pageIdSchema.optional(),
    contributionId: pageIdSchema.optional(),
    artistId: pageIdSchema.optional(),
    releaseId: pageIdSchema.optional()
  })
  .superRefine((value, ctx) => {
    const keyCount = [
      value.communityId,
      value.contributionId,
      value.artistId,
      value.releaseId
    ].filter((entry) => entry !== undefined).length;

    if (keyCount !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Exactly one target id is required'
      });
      return;
    }

    if (
      value.page === CommentPage.communities &&
      value.communityId === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'communityId is required for community comments',
        path: ['communityId']
      });
    }

    if (value.page === CommentPage.artist && value.artistId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'artistId is required for artist comments',
        path: ['artistId']
      });
    }

    if (
      (value.page === CommentPage.collages ||
        value.page === CommentPage.requests) &&
      value.contributionId === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'contributionId is required for this comment type',
        path: ['contributionId']
      });
    }

    if (value.page === CommentPage.release && value.releaseId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'releaseId is required for release comments',
        path: ['releaseId']
      });
    }
  });

export const updateCommentSchema = z.object({
  body: z.string().min(1, 'Body is required')
});

export type CommentQueryInput = z.infer<typeof commentQuerySchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;
