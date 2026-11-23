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
2. Sign in at https://ca.unraid.net/submit/new with an Unraid account, add
   `https://github.com/wondermoney/wondermoney`, run Validate and Scan, fix what they flag, and
   submit. The scan needs the root `LICENSE` (AGPL-3.0, OSI-approved) and `ca_profile.xml`, the
   publisher profile, with a non-empty `<Profile>`. It finds `<Container>` templates anywhere in
   the repository, so keep `deploy/unraid/` the only folder with one (the other XML files are bank
   statement fixtures). Field reference: https://ca.unraid.net/submit/help/xml-field-reference
3. `<Support>` is the GitHub issues page; a forum thread is optional. If one is opened later (only
   approved Community Developers start threads in the Docker Containers board, so post it elsewhere
   and ask a moderator to move it), add it as `<Forum>` in `ca_profile.xml`.
4. After moderation, search for WonderMoney in the Apps tab of a server to confirm the listing.
