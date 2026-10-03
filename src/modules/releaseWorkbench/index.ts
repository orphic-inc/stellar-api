import type {
  ReleaseContributionView,
  ReleaseTagView,
  ReleaseWorkbenchModule,
  ReleaseWorkbenchRef,
  ReleaseWorkbenchSession,
  ReleaseWorkbenchView,
  UpdateReleaseMetadataInput
} from './types';
import {
  getReleaseWorkbenchHistoryPage,
  getReleaseWorkbenchView
} from './load';
import { updateReleaseWorkbenchMetadata } from './metadata';
import { voteOnReleaseWorkbench } from './votes';
import {
  addReleaseWorkbenchTag,
  removeReleaseWorkbenchTag,
  voteOnReleaseWorkbenchTag
} from './tags';
import {
  attachReleaseWorkbenchContribution,
  listReleaseContributions
} from './contributions';
import { revertReleaseWorkbenchHistory } from './history';
import {
  addReleaseWorkbenchCredit,
  changeReleaseWorkbenchCreditRole,
  removeReleaseWorkbenchCredit
} from './credits';

const createSession = (ref: ReleaseWorkbenchRef): ReleaseWorkbenchSession => ({
  // The release page's two reads are the ones a report opens (ADR-0055 §3).
  getView: () => getReleaseWorkbenchView(ref, { allowReportScoped: true }),
  getHistoryPage: (input) => getReleaseWorkbenchHistoryPage(ref, input),
  updateMetadata: (
    input: UpdateReleaseMetadataInput
  ): Promise<ReleaseWorkbenchView> =>
    updateReleaseWorkbenchMetadata(ref, input),
  vote: (input: {
    direction: 'up' | 'down' | 'clear';
  }): Promise<ReleaseWorkbenchView> => voteOnReleaseWorkbench(ref, input),
  addTag: (input: { name: string }): Promise<ReleaseWorkbenchView> =>
    addReleaseWorkbenchTag(ref, input),
  voteTag: (input: {
    tagId: number;
    direction: 'up' | 'down';
  }): Promise<ReleaseTagView> => voteOnReleaseWorkbenchTag(ref, input),
  removeTag: (input: { tagId: number }): Promise<ReleaseWorkbenchView> =>
    removeReleaseWorkbenchTag(ref, input),
  attachContribution: (input): Promise<ReleaseContributionView> =>
    attachReleaseWorkbenchContribution(ref, input),
  listContributions: () => listReleaseContributions(ref),
  revertHistory: (input: {
    historyId: number;
  }): Promise<ReleaseWorkbenchView> =>
    revertReleaseWorkbenchHistory(ref, input),
  addCredit: (input) => addReleaseWorkbenchCredit(ref, input),
  changeCreditRole: (input) => changeReleaseWorkbenchCreditRole(ref, input),
  removeCredit: (input) => removeReleaseWorkbenchCredit(ref, input)
});

export const releaseWorkbench: ReleaseWorkbenchModule = {
  open: async (ref) => createSession(ref)
};
