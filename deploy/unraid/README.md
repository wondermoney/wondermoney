# Unraid template

`wondermoney.xml` is the Community Applications template for the all-in-one image
(`ghcr.io/wondermoney/wondermoney-aio`, built from `deploy/aio`); `wondermoney.png` is its icon.
The user guide is the docs page `self-hosting/unraid` (en, pt and es).

Unraid reads the template and the icon from the `main` branch (`TemplateURL`, `Icon`), so a change
reaches installs with the next release. Keep the template's variables in step with
`deploy/aio/wm-aio.sh` (what the container sets itself) and with `apps/api/deploy/selfhost/.env.example`
(the names and meanings of everything else).

## Listing it in Community Applications

Once the first release with the `wondermoney-aio` image is out and the image is public on ghcr.io:

1. Install the template by hand on an Unraid server (the docs page's `wget` line), install the
   container from it, and check a fresh install end to end: first account, a CSV import, a restart.
2. Open a support thread in the Unraid forum's Docker Containers board, named after the app. Put
   its address in the template as `<Support>`: CA requires a forum thread for support, and the
   GitHub issues stay linked from `<Project>` and the thread.
3. Submit this repository through the Community Applications submission form (linked from the
   CA plugin's settings and the forum's "Community Applications" board). CA scans the repository
   for `<Container>` templates, so keep `deploy/unraid/` the only folder with one (the other XML
   files in the repository are bank statement fixtures, which it ignores).
4. After moderation, search for WonderMoney in the Apps tab of a server to confirm the listing.
