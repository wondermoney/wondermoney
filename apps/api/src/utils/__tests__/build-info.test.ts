import { describe, expect, it } from 'vitest';

import { readBuildInfo } from '@utils/constants';

describe('readBuildInfo', () => {
  it.each([
    ['an unstamped local build is "dev" with no commit', '##REPLACE_GITHUB_COMMIT_SHA_HERE##', '##REPLACE_RELEASE_VERSION_HERE##', { commit: null, version: 'dev' }],
    ['a staging build has a commit but no release version', 'abc123', '', { commit: 'abc123', version: 'dev' }],
    ['a release image carries its tag and commit', 'abc123', '1.2.0', { commit: 'abc123', version: '1.2.0' }],
  ])('%s', (_, commit, version, expected) => {
    expect(readBuildInfo(commit, version)).toEqual(expected);
  });
});
