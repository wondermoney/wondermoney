// Lead-magnet guide content (email capture + lead magnet on content pages).
//
// This is genuinely useful, standalone editorial content — not a stub — delivered as a
// gated page (see src/pages/{locale}/*.astro guide routes + LeadMagnetGuidePage.astro)
// rather than an HTML email, because this codebase has no HTML email templating system
// (no `@wondermoney/react-email` or equivalent) and the only outbound-email transport
// available from the LP (`sendSupportEmail` -> POST /v1/support/email, see
// src/lib/leadCapture.ts) only notifies the WonderMoney team inbox — it cannot send a
// templated confirmation back to the submitter without a new API endpoint, which is out
// of scope for this repo. A gated page reuses the existing Astro/Tailwind content-page
// stack with zero new infrastructure and delivers the guide without a new endpoint.
//
// NOTE — translation status: the UI chrome around this guide
// (form labels, CTAs, success/error states, footer signup copy, this page's breadcrumb/meta
// copy) is fully translated in all 6 locales via `emailCapture` and `leadMagnetGuide` keys
// in src/locales/*/common.json. This long-form guide BODY is English-only, shipped as-is
// across all 6 locale routes pending native review/translation — flagged explicitly rather
// than silently shipping machine-translated financial content.

export type LeadMagnetGuideSection = {
	heading: string;
	paragraphs: string[];
};

export type LeadMagnetGuideFaq = {
	question: string;
	answer: string;
};

export type LeadMagnetGuideContent = {
	title: string;
	subtitle: string;
	intro: string[];
	keyTakeaways: string[];
	sections: LeadMagnetGuideSection[];
	faqs: LeadMagnetGuideFaq[];
};

export const leadMagnetGuide: LeadMagnetGuideContent = {
	title: "The 10-Minute Net Worth Check-In",
	subtitle:
		"A 10-minute routine to know exactly what you're worth — across every bank account, currency, and investment you hold.",
	intro: [
		"Net worth is the single number that tells you whether you're moving forward financially: everything you own, minus everything you owe. Most people only find out where they stand once a year, if that — usually when a bank statement or a tax form forces the issue.",
		"The problem isn't that net worth is hard to calculate. It's that doing it manually, across five apps and two currencies, takes an evening you don't have. This guide shows you a version that takes ten minutes — and how to make it take zero minutes going forward.",
	],
	keyTakeaways: [
		"Net worth = assets − liabilities. That's the whole formula.",
		"You only need three inputs: cash accounts, investments, and debts.",
		"Multi-currency and multi-bank households should convert everything to one reporting currency before comparing month to month.",
		"A single check-in doesn't tell you much. A monthly trend does.",
		"Automating the balance pull (via open banking) turns a chore into a habit.",
	],
	sections: [
		{
			heading: "Step 1: List every account that touches your money",
			paragraphs: [
				"Grab five minutes and a notepad. Write down every checking account, savings account, credit card, loan, and investment account you and your household hold — including the ones you rarely check. The old savings account from a previous bank, the brokerage you opened once and forgot about, the joint account you share with a partner: all of it counts.",
				"Most people underestimate their net worth simply because they forget an account exists, not because the math is wrong.",
			],
		},
		{
			heading: "Step 2: Pull today's balance for each one",
			paragraphs: [
				"For every account on your list, note today's balance. Assets — cash, savings, investments, property you'd actually sell — go in one column. Liabilities — credit card balances, loans, mortgages — go in another.",
				"If you're doing this manually, this is the step that eats your evening: logging into five separate banking apps, screenshotting balances, and re-typing them into a spreadsheet that's already out of date by the time you finish. Open banking aggregation exists to remove exactly this step: connect each account once, and every balance updates automatically from then on.",
			],
		},
		{
			heading: "Step 3: Convert everything to one currency",
			paragraphs: [
				"If you hold accounts in more than one currency — a euro salary account and a US-dollar brokerage, say — convert every balance to a single reporting currency before you add anything up. Skipping this step is the most common reason people's net worth appears to swing wildly month to month: it's not your finances moving, it's the exchange rate.",
				"Use a consistent source (the ECB reference rate is a reasonable default for EUR-based households) and apply it consistently, not whatever rate you happen to glance at that day.",
			],
		},
		{
			heading: "Step 4: Subtract liabilities from assets",
			paragraphs: [
				"Add up every asset. Add up every liability. Subtract the second number from the first. What's left is your net worth.",
				"Don't panic if it's negative — most people starting out, especially anyone with student loans or a recent mortgage, have a negative or near-zero net worth for a while. The number that matters isn't where you start; it's the direction it moves.",
			],
		},
		{
			heading: "Step 5: Write the number down somewhere you'll see it again",
			paragraphs: [
				"A single net worth snapshot is a photograph — interesting, but it doesn't tell you much on its own. A net worth trend, tracked monthly, is a story: it shows whether your saving, debt paydown, and investing are actually working.",
				"Put today's number next to last month's. If you don't have a last month's number yet, today is the one to start with.",
			],
		},
		{
			heading: "Make the next check-in take ten seconds, not ten minutes",
			paragraphs: [
				"The manual version of this exercise works, but it doesn't survive a busy month — and skipped check-ins are exactly how people lose sight of their finances.",
				"WonderMoney connects to your bank accounts, credit cards, and investment platforms through read-only open banking, converts every balance to your reporting currency automatically, and keeps your net worth chart up to date as new data arrives. The ten-minute version becomes a ten-second glance.",
			],
		},
	],
	faqs: [
		{
			question: "How often should I check my net worth?",
			answer:
				"Monthly is the sweet spot for most households — frequent enough to catch problems early, infrequent enough that day-to-day balance swings don't cause needless stress.",
		},
		{
			question: "Should I include my home in my net worth?",
			answer:
				"Include it if you'd actually consider selling it as part of your financial picture, using a conservative estimate of its current value minus what you still owe on the mortgage. Many people track it separately from their liquid net worth to keep the two comparable over time.",
		},
		{
			question: "What if my partner and I bank separately?",
			answer:
				"Calculate net worth for shared goals the same way you'd calculate household income: combine every account either of you would draw on to pay for a shared goal, and leave truly personal accounts out of the shared number if that's how you keep your finances.",
		},
	],
};
