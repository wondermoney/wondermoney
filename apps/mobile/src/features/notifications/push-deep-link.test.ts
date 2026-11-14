import { notificationHref } from './push-deep-link'

describe('notificationHref', () => {
  it.each([
    ['/budgets/3/2026/11', '/budgets/3/2026/11'],
    ['/budgets', '/budgets'],
    ['/accounts/42', '/accounts/42'],
    ['/more/banking', '/more/banking'],
    ['/settings/notifications', '/settings/notifications'],
  ])('opens %s', (url, href) => {
    expect(notificationHref({ url })).toBe(href)
  })

  it.each([
    ['another app', 'https://example.test/budgets'],
    ['a scheme link', 'wondermoney://pair?code=x'],
    ['a screen no notification is about', '/settings/security'],
    ['a month that does not exist', '/budgets/3/2026/13'],
    ['a path with extra segments', '/accounts/42/edit'],
    ['a relative path', 'budgets'],
  ])('ignores %s', (_case, url) => {
    expect(notificationHref({ url })).toBeNull()
  })

  it('ignores a notification without a usable url', () => {
    expect(notificationHref(undefined)).toBeNull()
    expect(notificationHref({})).toBeNull()
    expect(notificationHref({ url: 7 })).toBeNull()
  })
})
