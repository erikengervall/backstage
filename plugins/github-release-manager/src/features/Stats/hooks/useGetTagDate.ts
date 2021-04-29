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

import { useAsync } from 'react-use';

import { GitHubReleaseManagerError } from '../../../errors/GitHubReleaseManagerError';
import { ReleaseStats } from '../contexts/ReleaseStatsContext';
import { UnboxArray } from '../../../types/helpers';
import { usePluginApiClientContext } from '../../../contexts/PluginApiClientContext';
import { useProjectContext } from '../../../contexts/ProjectContext';
import { getTagDate } from '../helpers/getTagDate';

export const useGetTagDate = ({
  tag,
}: {
  tag: UnboxArray<ReleaseStats['releases']['0']['candidates']>;
}) => {
  const { pluginApiClient } = usePluginApiClientContext();
  const { project } = useProjectContext();

  const tagDate = useAsync(async () => {
    if (!tag) {
      throw new GitHubReleaseManagerError(
        'Missing tag details to get tag date',
      );
    }

    return await getTagDate({ pluginApiClient, project, tagSha: tag.sha });
  });

  return {
    tagDate,
  };
};
