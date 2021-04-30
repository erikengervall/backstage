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

import React, { useState, ComponentProps } from 'react';
import { Alert, AlertTitle } from '@material-ui/lab';
import { ErrorBoundary, useApi } from '@backstage/core';

import { CenteredCircularProgress } from '../components/CenteredCircularProgress';
import { CreateReleaseCandidate } from './CreateReleaseCandidate/CreateReleaseCandidate';
import { GitReleaseManager } from '../GitReleaseManager';
import { gitReleaseManagerApiRef } from '../api/serviceApiRef';
import { Info } from './Info/Info';
import { Patch } from './Patch/Patch';
import { PromoteRc } from './PromoteRc/PromoteRc';
import { RefetchContext } from '../contexts/RefetchContext';
import { useGetGitBatchInfo } from '../hooks/useGetGitBatchInfo';
import { useProjectContext } from '../contexts/ProjectContext';
import { useVersioningStrategyMatchesRepoTags } from '../hooks/useVersioningStrategyMatchesRepoTags';
import { validateTagName } from '../helpers/tagParts/validateTagName';

export function Features({
  features,
}: {
  features: ComponentProps<typeof GitReleaseManager>['features'];
}) {
  const pluginApiClient = useApi(gitReleaseManagerApiRef);
  const { project } = useProjectContext();
  const [refetchTrigger, setRefetchTrigger] = useState(0);
  const { gitBatchInfo } = useGetGitBatchInfo({
    pluginApiClient,
    project,
    refetchTrigger,
  });

  const { versioningStrategyMatches } = useVersioningStrategyMatchesRepoTags({
    latestReleaseTagName: gitBatchInfo.value?.latestRelease?.tagName,
    project,
    repositoryName: gitBatchInfo.value?.repository.name,
  });

  if (gitBatchInfo.error) {
    return (
      <Alert severity="error">
        Error occured while fetching information for "{project.owner}/
        {project.repo}" ({gitBatchInfo.error.message})
      </Alert>
    );
  }

  if (gitBatchInfo.loading) {
    return <CenteredCircularProgress />;
  }

  if (gitBatchInfo.value === undefined) {
    return <Alert severity="error">Failed to fetch latest Git release</Alert>;
  }

  if (!gitBatchInfo.value.repository.pushPermissions) {
    return (
      <Alert severity="error">
        You lack push permissions for repository "{project.owner}/{project.repo}
        "
      </Alert>
    );
  }

  const { tagNameError } = validateTagName({
    project,
    tagName: gitBatchInfo.value.latestRelease?.tagName,
  });
  if (tagNameError) {
    return (
      <Alert severity="error">
        {tagNameError.title && <AlertTitle>{tagNameError.title}</AlertTitle>}
        {tagNameError.subtitle}
      </Alert>
    );
  }

  return (
    <RefetchContext.Provider value={{ refetchTrigger, setRefetchTrigger }}>
      <ErrorBoundary>
        {gitBatchInfo.value.latestRelease && !versioningStrategyMatches && (
          <Alert severity="warning" style={{ marginBottom: 20 }}>
            Versioning mismatch, expected {project.versioningStrategy} version,
            got "{gitBatchInfo.value.latestRelease.tagName}"
          </Alert>
        )}

        {!gitBatchInfo.value.latestRelease && (
          <Alert severity="info" style={{ marginBottom: 20 }}>
            This repository doesn't have any releases yet
          </Alert>
        )}

        {!gitBatchInfo.value.releaseBranch && (
          <Alert severity="info" style={{ marginBottom: 20 }}>
            This repository doesn't have any release branches
          </Alert>
        )}

        {!features?.info?.omit && (
          <Info
            latestRelease={gitBatchInfo.value.latestRelease}
            releaseBranch={gitBatchInfo.value.releaseBranch}
            statsEnabled={features?.stats?.omit !== true}
          />
        )}

        {!features?.createRc?.omit && (
          <CreateReleaseCandidate
            latestRelease={gitBatchInfo.value.latestRelease}
            releaseBranch={gitBatchInfo.value.releaseBranch}
            defaultBranch={gitBatchInfo.value.repository.defaultBranch}
            successCb={features?.createRc?.successCb}
          />
        )}

        {!features?.promoteRc?.omit && (
          <PromoteRc
            latestRelease={gitBatchInfo.value.latestRelease}
            successCb={features?.promoteRc?.successCb}
          />
        )}

        {!features?.patch?.omit && (
          <Patch
            latestRelease={gitBatchInfo.value.latestRelease}
            releaseBranch={gitBatchInfo.value.releaseBranch}
            successCb={features?.patch?.successCb}
          />
        )}
      </ErrorBoundary>
    </RefetchContext.Provider>
  );
}