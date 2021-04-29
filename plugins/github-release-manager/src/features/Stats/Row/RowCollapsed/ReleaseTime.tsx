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

import React from 'react';
import { DateTime } from 'luxon';
import { Box, Typography } from '@material-ui/core';
import { Alert } from '@material-ui/lab';

import { CenteredCircularProgress } from '../../../../components/CenteredCircularProgress';
import { ReleaseStats } from '../../contexts/ReleaseStatsContext';
import { useGetTagDate } from '../../hooks/useGetTagDate';

interface ReleaseTimeProps {
  releaseStat: ReleaseStats['releases']['0'];
}

export function ReleaseTime({ releaseStat }: ReleaseTimeProps) {
  const firstCandidateTag = [...releaseStat.candidates].reverse()[0];
  const { tagDate: releaseCut } = useGetTagDate({ tag: firstCandidateTag });

  const mostRecentVersionTag = releaseStat.versions[0];
  const { tagDate: releaseComplete } = useGetTagDate({
    tag: mostRecentVersionTag,
  });

  if (releaseCut.loading || releaseComplete.loading) {
    return (
      <Wrapper>
        <CenteredCircularProgress />
      </Wrapper>
    );
  }

  if (releaseCut.error) {
    return (
      <Alert severity="error">
        Failed to fetch the first Release Candidate commit (
        {releaseCut.error.message})
      </Alert>
    );
  }

  const diff =
    releaseCut.value?.tagDate && releaseComplete.value?.tagDate
      ? DateTime.fromISO(releaseComplete.value.tagDate)
          .diff(DateTime.fromISO(releaseCut.value.tagDate), ['days', 'hours'])
          .toObject()
      : { days: -1 };

  return (
    <Wrapper>
      <Box
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'flex-start',
        }}
      >
        <Typography variant="body1">
          {releaseStat.versions.length === 0 ? '-' : 'Release completed '}
          {releaseComplete.value?.tagDate &&
            DateTime.fromISO(releaseComplete.value.tagDate)
              .setLocale('sv-SE')
              .toFormat('yyyy-MM-dd')}
        </Typography>
      </Box>

      <Box
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <Typography variant="h5" color="secondary">
          {diff.days === -1 ? (
            <>Ongoing: {diff.days} days</>
          ) : (
            <>Completed in: {diff.days} days</>
          )}
        </Typography>
      </Box>

      <Box
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'flex-end',
        }}
      >
        <Typography variant="body1">
          Release Candidate created{' '}
          {releaseCut.value?.tagDate &&
            DateTime.fromISO(releaseCut.value.tagDate)
              .setLocale('sv-SE')
              .toFormat('yyyy-MM-dd')}
        </Typography>
      </Box>
    </Wrapper>
  );
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <Box
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </Box>
  );
}
