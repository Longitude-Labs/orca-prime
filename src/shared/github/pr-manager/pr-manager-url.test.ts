import { describe, expect, it } from 'vitest'
import { parsePullRequestUrl, pullRequestRefKey, pullRequestRefUrl } from './pr-manager-url'

describe('parsePullRequestUrl', () => {
  it('reads a PR link, including tab paths, queries, fragments and surrounding whitespace', () => {
    for (const text of [
      'https://github.com/acme/widgets/pull/42',
      '  https://github.com/acme/widgets/pull/42/files?w=1#diff-1\n',
      'https://www.github.com/acme/widgets/pull/42/',
      'http://github.com/acme/widgets/pull/42/checks'
    ]) {
      expect(parsePullRequestUrl(text)).toEqual({ owner: 'acme', repo: 'widgets', number: 42 })
    }
  })

  it('keeps an enterprise host so the read goes to that server', () => {
    expect(parsePullRequestUrl('https://git.corp.example:8443/team/app/pull/7')).toEqual({
      host: 'git.corp.example:8443',
      owner: 'team',
      repo: 'app',
      number: 7
    })
  })

  it('refuses anything that is not exactly one PR link', () => {
    for (const text of [
      '',
      'acme/widgets#42',
      'https://github.com/acme/widgets/issues/42',
      'https://github.com/acme/widgets/pull/abc',
      'https://github.com/acme/widgets/pull/0',
      'https://github.com/acme/widgets',
      'see https://github.com/acme/widgets/pull/42',
      'https://github.com/acme/widgets/pull/42 https://github.com/acme/widgets/pull/43',
      'ftp://github.com/acme/widgets/pull/42',
      'javascript:alert(1)//github.com/a/b/pull/1'
    ]) {
      expect(parsePullRequestUrl(text)).toBeNull()
    }
  })

  it('round-trips through the canonical URL and keys case-insensitively', () => {
    const ref = parsePullRequestUrl('https://github.com/Acme/Widgets/pull/42')!
    expect(parsePullRequestUrl(pullRequestRefUrl(ref))).toEqual(ref)
    expect(pullRequestRefKey(ref)).toBe(
      pullRequestRefKey({ owner: 'acme', repo: 'widgets', number: 42 })
    )
  })
})
