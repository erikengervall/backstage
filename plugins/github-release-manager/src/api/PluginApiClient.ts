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

import { ConfigApi, OAuthApi } from '@backstage/core';
import { Octokit } from '@octokit/rest';
import { readGitHubIntegrationConfigs } from '@backstage/integration';

import { CalverTagParts } from '../helpers/tagParts/getCalverTagParts';
import { DISABLE_CACHE } from '../constants/constants';
import { OwnerRepo, UnboxArray, UnboxReturnedPromise } from '../types/helpers';
import { SemverTagParts } from '../helpers/tagParts/getSemverTagParts';

export class PluginApiClient implements IPluginApiClient {
  private readonly githubAuthApi: OAuthApi;
  private readonly baseUrl: string;
  readonly host: string;

  constructor({
    configApi,
    githubAuthApi,
  }: {
    configApi: ConfigApi;
    githubAuthApi: OAuthApi;
  }) {
    this.githubAuthApi = githubAuthApi;

    const githubIntegrationConfig = this.getGithubIntegrationConfig({
      configApi,
    });

    this.host = githubIntegrationConfig?.host ?? 'github.com';
    this.baseUrl =
      githubIntegrationConfig?.apiBaseUrl ?? 'https://api.github.com';
  }

  private getGithubIntegrationConfig({ configApi }: { configApi: ConfigApi }) {
    const configs = readGitHubIntegrationConfigs(
      configApi.getOptionalConfigArray('integrations.github') ?? [],
    );

    const githubIntegrationEnterpriseConfig = configs.find(v =>
      v.host.startsWith('ghe.'),
    );
    const githubIntegrationConfig = configs.find(v => v.host === 'github.com');

    // Prioritize enterprise configs if available
    return githubIntegrationEnterpriseConfig ?? githubIntegrationConfig;
  }

  private async getOctokit() {
    const token = await this.githubAuthApi.getAccessToken(['repo']);

    return {
      octokit: new Octokit({
        auth: token,
        baseUrl: this.baseUrl,
      }),
    };
  }

  public getHost() {
    return this.host;
  }

  public getRepoPath: IPluginApiClient['getRepoPath'] = ({ owner, repo }) => {
    return `${owner}/${repo}`;
  };

  getOwners: IPluginApiClient['getOwners'] = async () => {
    const { octokit } = await this.getOctokit();
    const orgListResponse = await octokit.paginate(
      octokit.orgs.listForAuthenticatedUser,
      { per_page: 100 },
    );

    return {
      owners: orgListResponse.map(organization => organization.login),
    };
  };

  getRepositories: IPluginApiClient['getRepositories'] = async ({ owner }) => {
    const { octokit } = await this.getOctokit();

    const repositoryResponse = await octokit
      .paginate(octokit.repos.listForOrg, { org: owner, per_page: 100 })
      .catch(async error => {
        // `owner` is not an org, try listing a user's repositories instead
        if (error.status === 404) {
          const userRepositoryResponse = await octokit.paginate(
            octokit.repos.listForUser,
            { username: owner, per_page: 100 },
          );
          return userRepositoryResponse;
        }

        throw error;
      });

    return {
      repositories: repositoryResponse.map(repository => repository.name),
    };
  };

  getUsername: IPluginApiClient['getUsername'] = async () => {
    const { octokit } = await this.getOctokit();
    const userResponse = await octokit.users.getAuthenticated();

    return {
      username: userResponse.data.login,
      email: userResponse.data.email,
    };
  };

  getRecentCommits: IPluginApiClient['getRecentCommits'] = async ({
    owner,
    repo,
    releaseBranchName,
  }) => {
    const { octokit } = await this.getOctokit();
    const recentCommitsResponse = await octokit.repos.listCommits({
      owner,
      repo,
      ...(releaseBranchName ? { sha: releaseBranchName } : {}),
      ...DISABLE_CACHE,
    });

    return recentCommitsResponse.data.map(commit => ({
      htmlUrl: commit.html_url,
      sha: commit.sha,
      author: {
        htmlUrl: commit.author?.html_url,
        login: commit.author?.login,
      },
      commit: {
        message: commit.commit.message,
      },
      firstParentSha: commit.parents?.[0]?.sha,
    }));
  };

  getLatestRelease: IPluginApiClient['getLatestRelease'] = async ({
    owner,
    repo,
  }) => {
    const { octokit } = await this.getOctokit();
    const { data: latestReleases } = await octokit.repos.listReleases({
      owner,
      repo,
      per_page: 1,
      ...DISABLE_CACHE,
    });

    if (latestReleases.length === 0) {
      return null;
    }

    const latestRelease = latestReleases[0];

    return {
      targetCommitish: latestRelease.target_commitish,
      tagName: latestRelease.tag_name,
      prerelease: latestRelease.prerelease,
      id: latestRelease.id,
      htmlUrl: latestRelease.html_url,
      body: latestRelease.body,
    };
  };

  getRepository: IPluginApiClient['getRepository'] = async ({
    owner,
    repo,
  }) => {
    const { octokit } = await this.getOctokit();
    const { data: repository } = await octokit.repos.get({
      owner,
      repo,
      ...DISABLE_CACHE,
    });

    return {
      pushPermissions: repository.permissions?.push,
      defaultBranch: repository.default_branch,
      name: repository.name,
    };
  };

  getLatestCommit: IPluginApiClient['getLatestCommit'] = async ({
    owner,
    repo,
    defaultBranch,
  }) => {
    const { octokit } = await this.getOctokit();
    const { data: latestCommit } = await octokit.repos.getCommit({
      owner,
      repo,
      ref: defaultBranch,
      ...DISABLE_CACHE,
    });

    return {
      sha: latestCommit.sha,
      htmlUrl: latestCommit.html_url,
      commit: {
        message: latestCommit.commit.message,
      },
    };
  };

  getBranch: IPluginApiClient['getBranch'] = async ({
    owner,
    repo,
    branchName,
  }) => {
    const { octokit } = await this.getOctokit();

    const { data: branch } = await octokit.repos.getBranch({
      owner,
      repo,
      branch: branchName,
      ...DISABLE_CACHE,
    });

    return {
      name: branch.name,
      links: {
        html: branch._links.html,
      },
      commit: {
        sha: branch.commit.sha,
        commit: {
          tree: {
            sha: branch.commit.commit.tree.sha,
          },
        },
      },
    };
  };

  createRc: IPluginApiClient['createRc'] = {
    createReleaseBranch: async ({
      owner,
      repo,
      mostRecentSha,
      targetBranch,
    }) => {
      const { octokit } = await this.getOctokit();
      const newReleaseBranch = await octokit.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${targetBranch}`,
        sha: mostRecentSha,
      });

      return {
        releaseBranchObjectSha: newReleaseBranch.data.object.sha,
      };
    },

    createTagObject: async ({
      owner,
      repo,
      releaseBranchObjectSha,
      rcReleaseTag,
      taggerName,
      taggerEmail,
    }) => {
      const { octokit } = await this.getOctokit();
      const createTagResponse = await octokit.git.createTag({
        owner,
        repo,
        tag: rcReleaseTag,
        message: `Tag generated by your friendly neighborhood Backstage Release Manager`,
        object: releaseBranchObjectSha,
        type: 'commit',
        tagger: {
          date: new Date().toISOString(),
          name: taggerName,
          email: taggerEmail,
        },
      });

      return {
        tagSha: createTagResponse.data.sha,
      };
    },

    createRef: async ({ owner, repo, tagSha, rcReleaseTag }) => {
      const { octokit } = await this.getOctokit();
      const createRefResponse = await octokit.git.createRef({
        owner,
        repo,
        ref: `refs/tags/${rcReleaseTag}`,
        sha: tagSha,
      });

      return {
        ref: createRefResponse.data.ref,
      };
    },

    getComparison: async ({
      owner,
      repo,
      previousReleaseBranch,
      nextReleaseBranch,
    }) => {
      const { octokit } = await this.getOctokit();
      const compareCommitsResponse = await octokit.repos.compareCommits({
        owner,
        repo,
        base: previousReleaseBranch,
        head: nextReleaseBranch,
      });

      return {
        htmlUrl: compareCommitsResponse.data.html_url,
        aheadBy: compareCommitsResponse.data.ahead_by,
      };
    },

    createRelease: async ({
      owner,
      repo,
      rcReleaseTag,
      releaseName,
      rcBranch,
      releaseBody,
    }) => {
      const { octokit } = await this.getOctokit();
      const createReleaseResponse = await octokit.repos.createRelease({
        owner,
        repo,
        tag_name: rcReleaseTag,
        name: releaseName,
        target_commitish: rcBranch,
        body: releaseBody,
        prerelease: true,
      });

      return {
        name: createReleaseResponse.data.name,
        htmlUrl: createReleaseResponse.data.html_url,
        tagName: createReleaseResponse.data.tag_name,
      };
    },
  };

  patch: IPluginApiClient['patch'] = {
    createTempCommit: async ({
      owner,
      repo,
      tagParts,
      releaseBranchTree,
      selectedPatchCommit,
    }) => {
      const { octokit } = await this.getOctokit();
      const { data: tempCommit } = await octokit.git.createCommit({
        owner,
        repo,
        message: `Temporary commit for patch ${tagParts.patch}`,
        tree: releaseBranchTree,
        parents: [selectedPatchCommit.firstParentSha ?? ''], // TODO: Avoid `??`
      });

      return {
        message: tempCommit.message,
        sha: tempCommit.sha,
      };
    },

    forceBranchHeadToTempCommit: async ({
      owner,
      repo,
      releaseBranchName,
      tempCommit,
    }) => {
      const { octokit } = await this.getOctokit();

      await octokit.git.updateRef({
        owner,
        repo,
        ref: `heads/${releaseBranchName}`,
        sha: tempCommit.sha,
        force: true,
      });
    },

    merge: async ({ owner, repo, base, head }) => {
      const { octokit } = await this.getOctokit();
      const { data: merge } = await octokit.repos.merge({
        owner,
        repo,
        base,
        head,
      });

      return {
        htmlUrl: merge.html_url,
        commit: {
          message: merge.commit.message,
          tree: {
            sha: merge.commit.tree.sha,
          },
        },
      };
    },

    createCherryPickCommit: async ({
      owner,
      repo,
      bumpedTag,
      selectedPatchCommit,
      mergeTree,
      releaseBranchSha,
      messageSuffix,
    }) => {
      const { octokit } = await this.getOctokit();
      const { data: cherryPickCommit } = await octokit.git.createCommit({
        owner,
        repo,
        message: `[patch ${bumpedTag}] ${selectedPatchCommit.commit.message}

${messageSuffix}`,
        tree: mergeTree,
        parents: [releaseBranchSha],
      });

      return {
        message: cherryPickCommit.message,
        sha: cherryPickCommit.sha,
      };
    },

    replaceTempCommit: async ({
      owner,
      repo,
      releaseBranchName,
      cherryPickCommit,
    }) => {
      const { octokit } = await this.getOctokit();
      const { data: updatedReference } = await octokit.git.updateRef({
        owner,
        repo,
        ref: `heads/${releaseBranchName}`,
        sha: cherryPickCommit.sha,
        force: true,
      });

      return {
        ref: updatedReference.ref,
        object: {
          sha: updatedReference.object.sha,
        },
      };
    },

    createTagObject: async ({
      owner,
      repo,
      bumpedTag,
      updatedReference,
      taggerName,
      taggerEmail,
    }) => {
      const { octokit } = await this.getOctokit();
      const { data: createdTagObject } = await octokit.git.createTag({
        owner,
        repo,
        message:
          'Tag generated by your friendly neighborhood Backstage Release Manager',
        tag: bumpedTag,
        object: updatedReference.object.sha,
        type: 'commit',
        tagger: {
          date: new Date().toISOString(),
          email: taggerEmail,
          name: taggerName,
        },
      });

      return {
        tag: createdTagObject.tag,
        sha: createdTagObject.sha,
      };
    },

    createReference: async ({ owner, repo, bumpedTag, createdTagObject }) => {
      const { octokit } = await this.getOctokit();
      const { data: reference } = await octokit.git.createRef({
        owner,
        repo,
        ref: `refs/tags/${bumpedTag}`,
        sha: createdTagObject.sha,
      });

      return {
        ref: reference.ref,
      };
    },

    updateRelease: async ({
      owner,
      repo,
      bumpedTag,
      latestRelease,
      tagParts,
      selectedPatchCommit,
    }) => {
      const { octokit } = await this.getOctokit();
      const { data: updatedRelease } = await octokit.repos.updateRelease({
        owner,
        repo,
        release_id: latestRelease.id,
        tag_name: bumpedTag,
        body: `${latestRelease.body}

#### [Patch ${tagParts.patch}](${selectedPatchCommit.htmlUrl})
  
${selectedPatchCommit.commit.message}`,
      });

      return {
        name: updatedRelease.name,
        tagName: updatedRelease.tag_name,
        htmlUrl: updatedRelease.html_url,
      };
    },
  };

  promoteRc: IPluginApiClient['promoteRc'] = {
    promoteRelease: async ({ owner, repo, releaseId, releaseVersion }) => {
      const { octokit } = await this.getOctokit();
      const { data: promotedRelease } = await octokit.repos.updateRelease({
        owner,
        repo,
        release_id: releaseId,
        tag_name: releaseVersion,
        prerelease: false,
      });

      return {
        name: promotedRelease.name,
        tagName: promotedRelease.tag_name,
        htmlUrl: promotedRelease.html_url,
      };
    },
  };

  stats: IPluginApiClient['stats'] = {
    getAllTags: async ({ owner, repo }) => {
      const { octokit } = await this.getOctokit();

      const tags = await octokit.paginate(octokit.repos.listTags, {
        owner,
        repo,
        per_page: 100,
        ...DISABLE_CACHE,
      });

      return tags.map(tag => ({
        tagName: tag.name,
        sha: tag.commit.sha,
      }));
    },

    getAllReleases: async ({ owner, repo }) => {
      const { octokit } = await this.getOctokit();

      const releases = await octokit.paginate(octokit.repos.listReleases, {
        owner,
        repo,
        per_page: 100,
        ...DISABLE_CACHE,
      });

      return releases.map(release => ({
        id: release.id,
        name: release.name,
        tagName: release.tag_name,
        createdAt: release.published_at,
        htmlUrl: release.html_url,
      }));
    },

    getCommit: async ({ owner, repo, ref }) => {
      const { octokit } = await this.getOctokit();

      const { data: commit } = await octokit.repos.getCommit({
        owner,
        repo,
        ref,
      });

      return {
        createdAt: commit.commit.committer?.date,
      };
    },
  };
}

export interface IPluginApiClient {
  getHost: () => string;

  getRepoPath: (args: OwnerRepo) => string;

  getOwners: () => Promise<{
    owners: string[];
  }>;

  getRepositories: (args: {
    owner: OwnerRepo['owner'];
  }) => Promise<{
    repositories: string[];
  }>;

  getUsername: (
    args: OwnerRepo,
  ) => Promise<{
    username: string;
    email: string | null;
  }>;

  getRecentCommits: (
    args: {
      releaseBranchName?: string;
    } & OwnerRepo,
  ) => Promise<
    {
      htmlUrl: string;
      sha: string;
      author: {
        htmlUrl?: string;
        login?: string;
      };
      commit: {
        message: string;
      };
      firstParentSha?: string;
    }[]
  >;

  getLatestRelease: (
    args: OwnerRepo,
  ) => Promise<{
    targetCommitish: string;
    tagName: string;
    prerelease: boolean;
    id: number;
    htmlUrl: string;
    body?: string | null;
  } | null>;

  getRepository: (
    args: OwnerRepo,
  ) => Promise<{
    pushPermissions: boolean | undefined;
    defaultBranch: string;
    name: string;
  }>;

  getLatestCommit: (
    args: {
      defaultBranch: string;
    } & OwnerRepo,
  ) => Promise<{
    sha: string;
    htmlUrl: string;
    commit: {
      message: string;
    };
  }>;

  getBranch: (
    args: {
      branchName: string;
    } & OwnerRepo,
  ) => Promise<{
    name: string;
    links: {
      html: string;
    };
    commit: {
      sha: string;
      commit: {
        tree: {
          sha: string;
        };
      };
    };
  }>;

  createRc: {
    createReleaseBranch: (
      args: {
        targetBranch: string;
        mostRecentSha: string;
      } & OwnerRepo,
    ) => Promise<{
      releaseBranchObjectSha: string;
    }>;

    /**
     * A tag object has to be created in
     * order to create annotated tags
     */
    createTagObject: (
      args: {
        releaseBranchObjectSha: string;
        rcReleaseTag: string;
        taggerName?: string;
        taggerEmail?: string;
      } & OwnerRepo,
    ) => Promise<{
      tagSha: string;
    }>;

    /**
     * Create the reference using the
     * tag object's sha
     */
    createRef: (
      args: {
        tagSha: string;
        rcReleaseTag: string;
      } & OwnerRepo,
    ) => Promise<{
      ref: string;
    }>;

    getComparison: (
      args: {
        previousReleaseBranch: string;
        nextReleaseBranch: string;
      } & OwnerRepo,
    ) => Promise<{
      htmlUrl: string;
      aheadBy: number;
    }>;

    createRelease: (
      args: {
        rcReleaseTag: string;
        releaseName: string;
        rcBranch: string;
        releaseBody: string;
      } & OwnerRepo,
    ) => Promise<{
      name: string | null;
      htmlUrl: string;
      tagName: string;
    }>;
  };
  patch: {
    createTempCommit: (
      args: {
        tagParts: SemverTagParts | CalverTagParts;
        releaseBranchTree: string;
        selectedPatchCommit: UnboxArray<
          UnboxReturnedPromise<IPluginApiClient['getRecentCommits']>
        >;
      } & OwnerRepo,
    ) => Promise<{
      message: string;
      sha: string;
    }>;

    forceBranchHeadToTempCommit: (
      args: {
        releaseBranchName: string;
        tempCommit: CreateTempCommitResult;
      } & OwnerRepo,
    ) => Promise<void>;

    merge: (
      args: {
        base: string;
        head: string;
      } & OwnerRepo,
    ) => Promise<{
      htmlUrl: string;
      commit: {
        message: string;
        tree: {
          sha: string;
        };
      };
    }>;

    createCherryPickCommit: (
      args: {
        bumpedTag: string;
        selectedPatchCommit: GetRecentCommitsResultSingle;
        mergeTree: string;
        releaseBranchSha: string;
        /**
         * The messageSuffix should be included at the
         * end of the cherry-pick commit's message.
         *
         * This will help identify the origin commit
         * and improve the UX for the patch feature.
         */
        messageSuffix: string;
      } & OwnerRepo,
    ) => Promise<{
      message: string;
      sha: string;
    }>;

    replaceTempCommit: (
      args: {
        releaseBranchName: string;
        cherryPickCommit: UnboxReturnedPromise<
          IPluginApiClient['patch']['createCherryPickCommit']
        >;
      } & OwnerRepo,
    ) => Promise<{
      ref: string;
      object: {
        sha: string;
      };
    }>;

    createTagObject: (
      args: {
        bumpedTag: string;
        updatedReference: ReplaceTempCommitResult;
        taggerName?: string;
        taggerEmail?: string;
      } & OwnerRepo,
    ) => Promise<{
      tag: string;
      sha: string;
    }>;

    createReference: (
      args: {
        bumpedTag: string;
        createdTagObject: CreateTagObjectResult;
      } & OwnerRepo,
    ) => Promise<{
      ref: string;
    }>;

    updateRelease: (
      args: {
        bumpedTag: string;
        latestRelease: NonNullable<GetLatestReleaseResult>;
        tagParts: SemverTagParts | CalverTagParts;
        selectedPatchCommit: GetRecentCommitsResultSingle;
      } & OwnerRepo,
    ) => Promise<{
      name: string | null;
      tagName: string;
      htmlUrl: string;
    }>;
  };

  promoteRc: {
    promoteRelease: (
      args: {
        releaseId: NonNullable<GetLatestReleaseResult>['id'];
        releaseVersion: string;
      } & OwnerRepo,
    ) => Promise<{
      name: string | null;
      tagName: string;
      htmlUrl: string;
    }>;
  };

  stats: {
    getAllTags: (
      args: OwnerRepo,
    ) => Promise<
      Array<{
        tagName: string;
        sha: string;
      }>
    >;

    getAllReleases: (
      args: OwnerRepo,
    ) => Promise<
      Array<{
        id: number;
        name: string | null;
        tagName: string;
        createdAt: string | null;
        htmlUrl: string;
      }>
    >;

    getCommit: (
      args: {
        ref: string;
      } & OwnerRepo,
    ) => Promise<{
      createdAt: string | undefined;
    }>;
  };
}

export type GetOwnersResult = UnboxReturnedPromise<
  IPluginApiClient['getOwners']
>;
export type GetRepositoriesResult = UnboxReturnedPromise<
  IPluginApiClient['getRepositories']
>;
export type GetUsernameResult = UnboxReturnedPromise<
  IPluginApiClient['getUsername']
>;
export type GetRecentCommitsResult = UnboxReturnedPromise<
  IPluginApiClient['getRecentCommits']
>;
export type GetRecentCommitsResultSingle = UnboxArray<GetRecentCommitsResult>;
export type GetLatestReleaseResult = UnboxReturnedPromise<
  IPluginApiClient['getLatestRelease']
>;
export type GetRepositoryResult = UnboxReturnedPromise<
  IPluginApiClient['getRepository']
>;
export type GetLatestCommitResult = UnboxReturnedPromise<
  IPluginApiClient['getLatestCommit']
>;
export type GetBranchResult = UnboxReturnedPromise<
  IPluginApiClient['getBranch']
>;
export type CreateReleaseBranchResult = UnboxReturnedPromise<
  IPluginApiClient['createRc']['createReleaseBranch']
>;
export type CreateTagObjectCreateRcResult = UnboxReturnedPromise<
  IPluginApiClient['createRc']['createTagObject']
>;
export type CreateRefResult = UnboxReturnedPromise<
  IPluginApiClient['createRc']['createRef']
>;
export type GetComparisonResult = UnboxReturnedPromise<
  IPluginApiClient['createRc']['getComparison']
>;
export type CreateReleaseResult = UnboxReturnedPromise<
  IPluginApiClient['createRc']['createRelease']
>;
export type CreateTempCommitResult = UnboxReturnedPromise<
  IPluginApiClient['patch']['createTempCommit']
>;
export type ForceBranchHeadToTempCommitResult = UnboxReturnedPromise<
  IPluginApiClient['patch']['forceBranchHeadToTempCommit']
>;
export type MergeResult = UnboxReturnedPromise<
  IPluginApiClient['patch']['merge']
>;
export type CreateCherryPickCommitResult = UnboxReturnedPromise<
  IPluginApiClient['patch']['createCherryPickCommit']
>;
export type ReplaceTempCommitResult = UnboxReturnedPromise<
  IPluginApiClient['patch']['replaceTempCommit']
>;
export type CreateTagObjectResult = UnboxReturnedPromise<
  IPluginApiClient['patch']['createTagObject']
>;
export type CreateReferenceResult = UnboxReturnedPromise<
  IPluginApiClient['patch']['createReference']
>;
export type UpdateReleaseResult = UnboxReturnedPromise<
  IPluginApiClient['patch']['updateRelease']
>;
export type PromoteReleaseResult = UnboxReturnedPromise<
  IPluginApiClient['promoteRc']['promoteRelease']
>;
export type GetAllTagsResult = UnboxReturnedPromise<
  IPluginApiClient['stats']['getAllTags']
>;
export type GetAllReleasesResult = UnboxReturnedPromise<
  IPluginApiClient['stats']['getAllReleases']
>;
export type GetCommitResult = UnboxReturnedPromise<
  IPluginApiClient['stats']['getCommit']
>;
