# Product Marketing Context

**Document version:** v1
**Last updated:** 2026-11-14

Drafted from `README.md` and the landing page's English copy. Lines marked **To confirm** are
the maintainer's to settle; the skills that read this file treat them as open.

## Product Overview
**One-liner:** Banks, budgets and investments in one place: free, open-source personal finance you can run yourself.
**What it does:** Tracks accounts and transactions, syncs European banks through read-only Open Banking, and covers budgets, goals, loans, shared households and investment portfolios, adding up to one net worth figure. Web, iOS and Android.
**Product category:** Personal finance app; budgeting app; net worth and portfolio tracker.
**Product type:** Open-source web and mobile app (AGPL-3.0), hosted or self-hosted.
**Business model:** Free, with no subscription, tiers or upsells. The hosted instance at wonder.money is funded by sponsors (GitHub Sponsors).

## Target Audience
**Who:** People in Europe, Portugal first, who manage their own money across several banks and brokers; and self-hosters who want their financial data on their own server.
**Primary use case:** Seeing every account, budget and investment together without a spreadsheet or five separate apps.
**Jobs to be done:**
- Know my net worth across every account and currency.
- See where the money goes each month and keep to a budget.
- Follow my investments next to my bank accounts.
- Manage money with a partner or family, with private accounts kept private.
- Keep my financial data under my own control.

## Personas
| Persona | Cares about | Challenge | Value we promise |
|---------|-------------|-----------|------------------|
| Multi-bank European household | One clear picture, shared with a partner | Banks, cards and brokers each have their own app | Everything in one place, synced by Open Banking |
| DIY investor | Net worth and portfolio performance | Broker exports (DEGIRO, Interactive Brokers) live apart from bank data | Import holdings, daily prices, one net worth number |
| Self-hoster | Privacy, ownership, no lock-in | Hosted finance apps hold the data and charge monthly | One Docker Compose file, own keys for the optional extras |

## Problems & Pain Points
**Core problem:** Money is spread over banks, cards, brokers and spreadsheets, so nobody sees the whole picture.
**Why alternatives fall short:**
- US-focused apps do not connect to European banks.
- Single-purpose tools cover budgeting or investing, never both.
- Subscription apps charge monthly for seeing one's own data.
**Emotional tension:** Not being sure where one stands financially, and not trusting an app with bank access.

## Competitive Landscape
**Direct:** YNAB: built for the US, budgeting only, paid. The landing page has a "YNAB alternative" page.
**Open-source alternatives:** Sure and Securo. **To confirm:** where WonderMoney is stronger and weaker than each; the competitor report holds the comparison.
**Mobile reference:** Guito (Portugal). **To confirm:** how to position against it.
**Indirect:** Spreadsheets, and each bank's own app.

## Differentiation
**Key differentiators:**
- Built for European banks: read-only Open Banking through Enable Banking.
- Banking, budgeting and investing in one app.
- Free and open source, with every feature included.
- Runs hosted or on your own server; the mobile app connects to any server.
**Why that's better:** One net worth number that includes everything, with no subscription and no lock-in.

## Objections
| Objection | Response |
|-----------|----------|
| Is my financial data safe? | Bank connections are read-only. You sign in with your bank or provider; WonderMoney never sees your credentials and cannot move money. You can revoke access. |
| Is my bank supported? | Most banks in Portugal and many across Europe; the bank picker confirms availability when you connect. |
| Why is it free? | It is open source, and sponsors fund the hosted instance. You can also run your own. |
| Can I get my data out? | Yes: export, and restore into another instance. |

**Anti-persona:** People who want an app to move money, pay bills or give investment advice.

## Customer Language
**Words to use:** free, open source, read-only, one place, net worth, your own server, household.
**Words to avoid:** plans, premium, upgrade, trial; "costs less" (it is free); "AI-powered" as a headline.
**In Portuguese:** European Portuguese, addressing the reader as "tu"; the product is "o WonderMoney".
**Glossary:** `apps/api/GLOSSARY.md` and the docs site glossary.

## Brand Voice
**Tone:** Calm and plain. Says what the product does and what it cannot do.
**Style:** Short sentences, concrete nouns, no hype.
**Personality:** Trustworthy, open, practical.

## Proof Points
**Metrics:** **To confirm:** users, households, GitHub stars, banks supported.
**Value themes:**
| Theme | Proof |
|-------|-------|
| Open | Public code under AGPL-3.0, public roadmap |
| Safe | Read-only Open Banking; credentials never reach WonderMoney |
| Complete | Banks, budgets, goals, loans and portfolios feeding one net worth figure |
| Yours | Self-hosting with Docker Compose, Helm or Render; export and restore |

## Goals
**Business goal:** **To confirm:** hosted sign-ups, self-hosted installs, sponsors, or contributors, and in which order.
**Conversion action:** Create a free account at wonder.money; second, try the demo; third, self-host.
**Current metrics:** **To confirm.**

## Changelog
*Newest first. One line per revision: what changed and why.*
- v1 (2026-11-14): Initial context, drafted from the README and the landing page copy.
