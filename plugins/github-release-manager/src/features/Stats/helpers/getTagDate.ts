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

import { IPluginApiClient } from '../../../api/PluginApiClient';
import { Project } from '../../../contexts/ProjectContext';

interface GetTagDate {
  pluginApiClient: IPluginApiClient;
  project: Project;
  tagSha: string;
}

export const getTagDate = async ({
  pluginApiClient,
  project,
  tagSha,
}: GetTagDate) => {
  try {
    // Always attempt to fetch annotated tag first as
    // it the tag itself has a date attached to it
    const singleTag = await pluginApiClient.stats.getSingleTag({
      owner: project.owner,
      repo: project.repo,
      tagSha: tagSha,
    });

    return {
      tagDate: singleTag.date,
    };
  } catch (error) {
    // If tag isn't annotated, fallback to commit's createAt
    const commitRes = await pluginApiClient.stats.getCommit({
      owner: project.owner,
      repo: project.repo,
      ref: tagSha,
    });

    return {
      tagDate: commitRes.createdAt,
    };
  }
};
