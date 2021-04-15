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

import { ComponentConfigPromoteRc, ResponseStep } from '../../../types/types';
import {
  ApiMethodRetval,
  IPluginApiClient,
} from '../../../api/PluginApiClient';
import { Project } from '../../../contexts/ProjectContext';

interface PromoteRc {
  pluginApiClient: IPluginApiClient;
  project: Project;
  rcRelease: NonNullable<
    ApiMethodRetval<IPluginApiClient['getLatestRelease']>['latestRelease']
  >;
  releaseVersion: string;
  successCb?: ComponentConfigPromoteRc['successCb'];
}

export function promoteRc({
  pluginApiClient,
  project,
  rcRelease,
  releaseVersion,
  successCb,
}: PromoteRc) {
  return async (): Promise<ResponseStep[]> => {
    const responseSteps: ResponseStep[] = [];

    const { release } = await pluginApiClient.promoteRc.promoteRelease({
      ...project,
      releaseId: rcRelease.id,
      releaseVersion,
    });
    responseSteps.push({
      message: `Promoted "${release.name}"`,
      secondaryMessage: `from "${rcRelease.tagName}" to "${release.tag_name}"`,
      link: release.html_url,
    });

    await successCb?.({
      gitHubReleaseUrl: release.html_url,
      gitHubReleaseName: release.name,
      previousTagUrl: rcRelease.htmlUrl,
      previousTag: rcRelease.tagName,
      updatedTagUrl: release.html_url,
      updatedTag: release.tag_name,
    });

    return responseSteps;
  };
}