import type { ComponentType } from "react";
import {
	ArrowLeftRight,
	BookOpen,
	Boxes,
	CalendarClock,
	CalendarDays,
	CalendarPlus,
	ChartLine,
	ChartPie,
	CircleAlert,
	CircleCheck,
	ClipboardCheck,
	Clock,
	Coins,
	Container,
	CopyCheck,
	Divide,
	EyeOff,
	FileCode,
	FileSpreadsheet,
	Hash,
	Import,
	KeyRound,
	Landmark,
	Layers,
	Link2Off,
	ListFilter,
	Lock,
	MessageSquare,
	Plug,
	Puzzle,
	Scale,
	ScanSearch,
	Server,
	ShieldCheck,
	Tags,
	ToggleRight,
	UserPlus,
	Users,
	Wallet,
	type LucideIcon,
} from "lucide-react";
import {
	AssistantPreview,
	HouseholdPreview,
	ImportsPreview,
	MultiCurrencyPreview,
	RecurringPreview,
	SelfHostingPreview,
} from "@/components/homepage/previews/FeatureDetailPreviews";

/**
 * An explanatory section of a feature page, read from `lp.<namespace>.<key>*`: `Title`, then
 * `Body` when `body`, `PointsTitle` when `pointsTitle`, and per icon either `Point<n>` or, with
 * `titledPoints`, `Point<n>Title` and `Point<n>Body`.
 */
export type FeatureDetailSection = {
	key: string;
	icons: ReadonlyArray<LucideIcon>;
	body?: boolean;
	pointsTitle?: boolean;
	titledPoints?: boolean;
	visual?: ComponentType;
	tone?: "plain" | "muted";
	reverse?: boolean;
	columns?: 1 | 2;
};

export type FeatureDetailConfig = {
	/** The translation namespace under `lp`. */
	ns: string;
	Preview: ComponentType;
	/** The first sits above the steps, the rest below them. */
	sections: readonly [FeatureDetailSection, ...FeatureDetailSection[]];
};

/** The feature pages added in #600, rendered by `FeatureDetail.tsx`. */
export const FEATURE_DETAILS = {
	featureHousehold: {
		ns: "featureHousehold",
		Preview: HouseholdPreview,
		sections: [
			{ key: "what", body: true, titledPoints: true, columns: 1, icons: [Users, Lock, ListFilter, ChartPie] },
			{ key: "groups", body: true, icons: [UserPlus, Divide, Scale, Wallet], reverse: true },
		],
	},
	featureImports: {
		ns: "featureImports",
		Preview: ImportsPreview,
		sections: [
			{ key: "what", body: true, icons: [FileSpreadsheet, FileCode, Landmark, Layers, Import, ArrowLeftRight] },
			{ key: "review", body: true, titledPoints: true, columns: 1, icons: [ScanSearch, CopyCheck, Tags], reverse: true },
		],
	},
	featureRecurring: {
		ns: "featureRecurring",
		Preview: RecurringPreview,
		sections: [
			{ key: "what", body: true, icons: [ScanSearch, CircleCheck, CalendarDays, ChartLine] },
			{ key: "calendar", body: true, icons: [CalendarPlus, CalendarClock, EyeOff, Link2Off], reverse: true },
		],
	},
	featureAssistant: {
		ns: "featureAssistant",
		Preview: AssistantPreview,
		sections: [
			{ key: "what", body: true, icons: [MessageSquare, ToggleRight, ClipboardCheck, EyeOff] },
			{ key: "mcp", body: true, icons: [Plug, ShieldCheck, ClipboardCheck, KeyRound], reverse: true },
		],
	},
	featureMultiCurrency: {
		ns: "featureMultiCurrency",
		Preview: MultiCurrencyPreview,
		sections: [
			{ key: "what", body: true, icons: [Coins, Landmark, ArrowLeftRight, CircleAlert, Clock] },
			{ key: "household", body: true, icons: [Users, Wallet, ChartLine, Scale], reverse: true },
		],
	},
	featureSelfHosting: {
		ns: "featureSelfHosting",
		Preview: SelfHostingPreview,
		sections: [
			{ key: "what", body: true, icons: [Container, Server, Puzzle, KeyRound, Landmark, Boxes] },
			{ key: "api", body: true, icons: [BookOpen, KeyRound, Clock, Hash], reverse: true },
		],
	},
} as const satisfies Record<string, FeatureDetailConfig>;

export type FeatureDetailRouteId = keyof typeof FEATURE_DETAILS;

export const FEATURE_DETAIL_ROUTE_IDS = Object.keys(FEATURE_DETAILS) as FeatureDetailRouteId[];

export function isFeatureDetailRouteId(routeId: string): routeId is FeatureDetailRouteId {
	return Object.hasOwn(FEATURE_DETAILS, routeId);
}
