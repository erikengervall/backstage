/*
 * Copyright 2021 Spotify AB
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useEffect, useState } from 'react';
import { useAsync, useAsyncFn } from 'react-use';

import {
  GetLatestReleaseResult,
  GetRepositoryResult,
} from '../../../api/PluginApiClient';
import { CardHook, ComponentConfigCreateRc } from '../../../types/types';
import { getRcGitHubInfo } from '../../../helpers/getRcGitHubInfo';
import { GitHubReleaseManagerError } from '../../../errors/GitHubReleaseManagerError';
import { Project } from '../../../contexts/ProjectContext';
import { usePluginApiClientContext } from '../../../contexts/PluginApiClientContext';
import { useResponseSteps } from '../../../hooks/useResponseSteps';
import { useUserContext } from '../../../contexts/UserContext';

interface CreateRC {
  defaultBranch: GetRepositoryResult['defaultBranch'];
  latestRelease: GetLatestReleaseResult;
  nextGitHubInfo: ReturnType<typeof getRcGitHubInfo>;
  project: Project;
  successCb?: ComponentConfigCreateRc['successCb'];
}

export function useCreateRc({
  defaultBranch,
  latestRelease,
  nextGitHubInfo,
  project,
  successCb,
}: CreateRC): CardHook<void> {
  const { pluginApiClient } = usePluginApiClientContext();
  const { user } = useUserContext();

  if (nextGitHubInfo.error) {
    throw new GitHubReleaseManagerError(
      `Unexpected error: ${
        nextGitHubInfo.error.title
          ? `${nextGitHubInfo.error.title} (${nextGitHubInfo.error.subtitle})`
          : nextGitHubInfo.error.subtitle
      }`,
    );
  }

  const {
    responseSteps,
    addStepToResponseSteps,
    asyncCatcher,
    abortIfError,
  } = useResponseSteps();

  /**
   * (1) Get the default branch's most recent commit
   */
  const [latestCommitRes, run] = useAsyncFn(async () => {
    const latestCommit = await pluginApiClient
      .getLatestCommit({
        owner: project.owner,
        repo: project.repo,
        branch: defaultBranch,
      })
      .catch(asyncCatcher);

    addStepToResponseSteps({
      message: `Fetched latest commit from "${defaultBranch}"`,
      secondaryMessage: `with message "${latestCommit.commit.message}"`,
      link: latestCommit.htmlUrl,
    });

    return {
      latestCommit,
    };
  });

  /**
   * (2) Create release branch based on default branch's most recent sha
   */
  const releaseBranchRes = useAsync(async () => {
    abortIfError(latestCommitRes.error);
    if (!latestCommitRes.value) return undefined;

    const createdReleaseBranch = await pluginApiClient.createRc
      .createReleaseBranch({
        owner: project.owner,
        repo: project.repo,
        mostRecentSha: latestCommitRes.value.latestCommit.sha,
        targetBranch: nextGitHubInfo.rcBranch,
      })
      .catch(error => {
        if (error?.body?.message === 'Reference already exists') {
          throw new GitHubReleaseManagerError(
            `Branch "${nextGitHubInfo.rcBranch}" already exists: .../tree/${nextGitHubInfo.rcBranch}`,
          );
        }
        throw error;
      })
      .catch(asyncCatcher);

    addStepToResponseSteps({
      message: 'Created Release Branch',
      secondaryMessage: `with object sha "${createdReleaseBranch.releaseBranchObjectSha}"`,
    });

    return {
      ...createdReleaseBranch,
    };
  }, [latestCommitRes.value, latestCommitRes.error]);

  /**
   * (3) Create tag object for our soon-to-be-created annotated tag
   */
  const tagObjectRes = useAsync(async () => {
    abortIfError(releaseBranchRes.error);
    if (!releaseBranchRes.value) return undefined;

    const createdTagObject = await pluginApiClient
      .createTagObject({
        owner: project.owner,
        repo: project.repo,
        tag: nextGitHubInfo.rcReleaseTag,
        object: releaseBranchRes.value.releaseBranchObjectSha,
        taggerName: user.username,
        taggerEmail: user.email,
      })
      .catch(asyncCatcher);

    addStepToResponseSteps({
      message: 'Created Tag Object',
      secondaryMessage: `with sha "${createdTagObject.tagSha}"`,
    });

    return {
      ...createdTagObject,
    };
  }, [releaseBranchRes.value, releaseBranchRes.error]);

  /**
   * (4) Create reference for tag object
   */
  const createRcRes = useAsync(async () => {
    abortIfError(tagObjectRes.error);
    if (!tagObjectRes.value) return undefined;

    const createdRef = await pluginApiClient
      .createReference({
        owner: project.owner,
        repo: project.repo,
        tagName: nextGitHubInfo.rcReleaseTag,
        tagSha: tagObjectRes.value.tagSha,
      })
      .catch(error => {
        if (error?.body?.message === 'Reference already exists') {
          throw new GitHubReleaseManagerError(
            `Tag reference "${nextGitHubInfo.rcReleaseTag}" already exists`,
          );
        }
        throw error;
      })
      .catch(asyncCatcher);

    addStepToResponseSteps({
      message: 'Cut Tag Reference',
      secondaryMessage: `with ref "${createdRef.ref}"`,
    });

    return {
      ...createdRef,
    };
  }, [tagObjectRes.value, tagObjectRes.error]);

  /**
   * (5) Compose a body for the release
   */
  const getComparisonRes = useAsync(async () => {
    abortIfError(createRcRes.error);
    if (!createRcRes.value) return undefined;

    const previousReleaseBranch = latestRelease
      ? latestRelease.targetCommitish
      : defaultBranch;
    const nextReleaseBranch = nextGitHubInfo.rcBranch;
    const comparison = await pluginApiClient.createRc
      .getComparison({
        owner: project.owner,
        repo: project.repo,
        previousReleaseBranch,
        nextReleaseBranch,
      })
      .catch(asyncCatcher);

    const releaseBody = `**Compare** ${comparison.htmlUrl}

**Ahead by** ${comparison.aheadBy} commits

**Release branch** ${createRcRes.value.ref}

---

`;

    addStepToResponseSteps({
      message: 'Fetched commit comparison',
      secondaryMessage: `${previousReleaseBranch}...${nextReleaseBranch}`,
      link: comparison.htmlUrl,
    });

    return {
      ...comparison,
      releaseBody,
    };
  }, [createRcRes.value, createRcRes.error]);

  /**
   * (6) Creates the release itself in GitHub
   */
  const createReleaseRes = useAsync(async () => {
    abortIfError(getComparisonRes.error);
    if (!getComparisonRes.value) return undefined;

    const createReleaseResult = await pluginApiClient.createRc
      .createRelease({
        owner: project.owner,
        repo: project.repo,
        rcReleaseTag: nextGitHubInfo.rcReleaseTag,
        releaseName: nextGitHubInfo.releaseName,
        rcBranch: nextGitHubInfo.rcBranch,
        releaseBody: getComparisonRes.value.releaseBody,
      })
      .catch(asyncCatcher);

    addStepToResponseSteps({
      message: `Created Release Candidate "${createReleaseResult.name}"`,
      secondaryMessage: `with tag "${nextGitHubInfo.rcReleaseTag}"`,
      link: createReleaseResult.htmlUrl,
    });

    return {
      ...createReleaseResult,
    };
  }, [getComparisonRes.value, getComparisonRes.error]);

  /**
   * (7) Run successCb if defined
   */
  useAsync(async () => {
    if (successCb && !!createReleaseRes.value && !!getComparisonRes.value) {
      abortIfError(createReleaseRes.error);

      try {
        await successCb({
          comparisonUrl: getComparisonRes.value.htmlUrl,
          createdTag: createReleaseRes.value.tagName,
          gitHubReleaseName: createReleaseRes.value.name,
          gitHubReleaseUrl: createReleaseRes.value.htmlUrl,
          previousTag: latestRelease?.tagName,
        });
      } catch (error) {
        asyncCatcher(error);
      }

      addStepToResponseSteps({
        message: 'Success callback successfully called 🚀',
        icon: 'success',
      });
    }
  }, [createReleaseRes.value]);

  const TOTAL_STEPS = 6 + (!!successCb ? 1 : 0);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    setProgress((responseSteps.length / TOTAL_STEPS) * 100);
  }, [TOTAL_STEPS, responseSteps.length]);

  return {
    progress,
    responseSteps,
    run,
    runInvoked: Boolean(
      latestCommitRes.loading || latestCommitRes.value || latestCommitRes.error,
    ),
  };
}
