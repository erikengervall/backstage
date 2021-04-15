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

import React, { useState } from 'react';
import { useAsync } from 'react-use';
import { useForm } from 'react-hook-form';
import { Alert } from '@material-ui/lab';
import { makeStyles } from '@material-ui/core';
import { useApi, ContentHeader, ErrorBoundary } from '@backstage/core';

import { CreateRc } from './cards/createRc/CreateRc';
import { getGitHubBatchInfo } from './sideEffects/getGitHubBatchInfo';
import { Info } from './cards/info/Info';
import { Patch } from './cards/patchRc/Patch';
import {
  ComponentConfigCreateRc,
  ComponentConfigPatch,
  ComponentConfigPromoteRc,
} from './types/types';
import { PromoteRc } from './cards/promoteRc/PromoteRc';
import { githubReleaseManagerApiRef } from './api/serviceApiRef';
import {
  PluginApiClientContext,
  usePluginApiClientContext,
} from './contexts/PluginApiClientContext';
import { ProjectContext, Project } from './contexts/ProjectContext';
import { isProjectValid } from './cards/projectForm/isProjectValid';
import { InfoCardPlus } from './components/InfoCardPlus';
import { RepoDetailsForm } from './cards/projectForm/RepoDetailsForm';
import { CenteredCircularProgress } from './components/CenteredCircularProgress';
import { useVersioningStrategyMatchesRepoTags } from './helpers/useVersioningStrategyMatchesRepoTags';

interface GitHubReleaseManagerProps {
  components?: {
    default?: {
      createRc?: ComponentConfigCreateRc;
      promoteRc?: ComponentConfigPromoteRc;
      patch?: ComponentConfigPatch;
    };
  };
}

const useStyles = makeStyles(() => ({
  root: {
    maxWidth: '999px',
  },
}));

export function GitHubReleaseManager({
  components,
}: GitHubReleaseManagerProps) {
  const pluginApiClient = useApi(githubReleaseManagerApiRef);
  const classes = useStyles();
  const usernameResponse = useAsync(() => pluginApiClient.getUsername());
  const { control, watch } = useForm();
  const project: Project = watch('repo-details-form');

  if (usernameResponse.error) {
    return <Alert severity="error">{usernameResponse.error.message}</Alert>;
  }

  if (usernameResponse.loading) {
    return <CenteredCircularProgress />;
  }

  if (!usernameResponse.value?.username) {
    return <Alert severity="error">Unable to retrieve username</Alert>;
  }

  return (
    <PluginApiClientContext.Provider value={pluginApiClient}>
      <div className={classes.root}>
        <ContentHeader title="GitHub Release Manager" />

        <InfoCardPlus>
          <RepoDetailsForm
            control={control}
            username={usernameResponse.value.username}
          />
        </InfoCardPlus>

        {isProjectValid(project) && (
          <Cards components={components} project={project} />
        )}
      </div>
    </PluginApiClientContext.Provider>
  );
}

function Cards({
  components,
  project,
}: {
  components: GitHubReleaseManagerProps['components'];
  project: Project;
}) {
  const pluginApiClient = usePluginApiClientContext();
  const [refetch, setRefetch] = useState(0);
  const gitHubBatchInfo = useAsync(
    getGitHubBatchInfo({ project, pluginApiClient }),
    [project, refetch],
  );

  const { versioningStrategyMatches } = useVersioningStrategyMatchesRepoTags({
    latestReleaseTagName: gitHubBatchInfo.value?.latestRelease?.tagName,
    project,
    repositoryName: gitHubBatchInfo.value?.repository.name,
  });

  if (gitHubBatchInfo.error) {
    return <Alert severity="error">{gitHubBatchInfo.error.message}</Alert>;
  }

  if (gitHubBatchInfo.loading) {
    return <CenteredCircularProgress />;
  }

  if (gitHubBatchInfo.value === undefined) {
    return (
      <Alert severity="error">Failed to fetch latest GitHub release</Alert>
    );
  }

  if (!gitHubBatchInfo.value.repository.pushPermissions) {
    return (
      <Alert severity="error">
        You lack push permissions for repository "{project.owner}/{project.repo}
        "
      </Alert>
    );
  }

  if (!versioningStrategyMatches) {
    return (
      <Alert severity="error">
        Versioning mismatch, expected {project.versioningStrategy} version, got{' '}
        {gitHubBatchInfo.value.latestRelease?.tagName}
      </Alert>
    );
  }

  return (
    <ProjectContext.Provider value={project}>
      <ErrorBoundary>
        <Info
          latestRelease={gitHubBatchInfo.value.latestRelease}
          releaseBranch={gitHubBatchInfo.value.releaseBranch}
        />

        {components?.default?.createRc?.omit !== true && (
          <CreateRc
            latestRelease={gitHubBatchInfo.value.latestRelease}
            releaseBranch={gitHubBatchInfo.value.releaseBranch}
            defaultBranch={gitHubBatchInfo.value.repository.defaultBranch}
            setRefetch={setRefetch}
            successCb={components?.default?.createRc?.successCb}
          />
        )}

        {components?.default?.promoteRc?.omit !== true && (
          <PromoteRc
            latestRelease={gitHubBatchInfo.value.latestRelease}
            setRefetch={setRefetch}
            successCb={components?.default?.promoteRc?.successCb}
          />
        )}

        {components?.default?.patch?.omit !== true && (
          <Patch
            latestRelease={gitHubBatchInfo.value.latestRelease}
            releaseBranch={gitHubBatchInfo.value.releaseBranch}
            setRefetch={setRefetch}
            successCb={components?.default?.patch?.successCb}
          />
        )}
      </ErrorBoundary>
    </ProjectContext.Provider>
  );
}