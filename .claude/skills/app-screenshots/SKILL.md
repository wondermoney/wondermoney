---
name: app-screenshots
description: Captures screenshots of the WonderMoney web app and the iOS and Android apps from a seeded local stack, has them design-reviewed, and publishes them as one gallery with web and mobile side by side. Use when asked for screenshots, a visual audit, a web and mobile parity check, or to update the screenshot gallery.
---

# App screenshots

One run captures the **same screens on every platform**, so the set can be compared screen by
screen. The screens are listed in [`screens.md`](screens.md).

## Steps

1. **Local stack with seeded data.** Screenshots come from a local database only; nothing here
   connects to staging or production.
   - API: in `apps/api`, `pnpm bootstrap` (local Postgres on 5434, migrations, the development
     seed with its demo account), then confirm the target with `grep -E '^DB_' .env` before
     starting it. `apps/api/README.md` has the seeded accounts and their passwords.
   - Start `pnpm dev:api` and `pnpm dev:web` from the root, and the worker when a screen needs
     background work.
   - Sign in as the demo account. A screen the seed leaves empty is captured empty and listed
     in the report as **thin data**, with what the seed would need.

2. **Capture web** with the browser tools of this session, or the `agent-browser` CLI the way
   `apps/web/scripts/e2e-smoke-agent-browser.sh` drives it. For every screen in `screens.md`:
   desktop at 1440 wide and phone at 390 wide, in light and in dark.

3. **Capture mobile** on the iOS simulator and the Android emulator, with the Expo tooling
   under Node 24 (`apps/mobile/.nvmrc`). Point the app at the local API from its sign-in
   screen. For every screen, in light and in dark:

   ```bash
   # iOS
   xcrun simctl ui <udid> appearance dark            # or light
   xcrun simctl openurl <udid> "wondermoney://<route>"
   xcrun simctl io <udid> screenshot <file>.png
   # Android
   adb shell cmd uimode night yes                    # or no
   adb shell am start -a android.intent.action.VIEW -d "wondermoney://<route>"
   adb exec-out screencap -p > <file>.png
   ```

   Wait for the data to load before each capture; a spinner or skeleton is a failed capture.
   Screens reached only by a tap (sheets, menus, forms mid-edit) are driven by hand.

4. **Name** the files `<platform>/<theme>/<nn>-<screen>.png`, with `web-desktop`, `web-phone`,
   `ios` and `android` as platforms and the number and name from `screens.md`, in the
   session's scratch directory. Screenshots never enter the repository.

5. **Review.** Dispatch one `design-reviewer` agent per platform, in parallel, each with its
   directory and the web set for parity. Their findings go into the gallery and the report.

6. **Publish the gallery** as an Artifact: one section per screen, the platforms side by side,
   a light and dark switch, the reviewer's findings under each screen, and a summary of
   findings by severity at the top. Look for the existing gallery first (the Artifact tool's
   list action) and update it, so its link stays the same.

## Done

Every screen in `screens.md` is captured on each of the four platforms in both themes, or is
listed in the report with the reason it is missing. The report gives the gallery link, the
thin-data screens and the findings that recur across screens.

When a route is added to an app, add its row to `screens.md`.
