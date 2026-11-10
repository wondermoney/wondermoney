import deCommon from "../locales/de/common.json";
import enCommon from "../locales/en/common.json";
import esCommon from "../locales/es/common.json";
import frCommon from "../locales/fr/common.json";
import itCommon from "../locales/it/common.json";
import ptCommon from "../locales/pt/common.json";

import { SUPPORTED_LANGS, type Lang, toLang } from "./i18nLocale";

type TranslationNode = {
	[key: string]: TranslationNode | string | number | boolean | null | TranslationNode[];
};

export type TranslationPrimitive = string | number | boolean | null;

export type TranslationValue =
	| TranslationNode
	| TranslationNode[]
	| TranslationPrimitive;

export type TranslationOptions = {
	defaultValue?: string;
	returnObjects?: boolean;
	[key: string]: unknown;
};

export type ReturnObjectsTranslationOptions = TranslationOptions & {
	returnObjects: true;
};

const dictionaries: Record<Lang, TranslationNode> = {
	pt: ptCommon,
	en: enCommon,
	es: esCommon,
	fr: frCommon,
	de: deCommon,
	it: itCommon,
};

export const supportedLocales = SUPPORTED_LANGS;

function lookupTranslation(locale: Lang, keyPath: string): TranslationValue {
	const dictionary = dictionaries[locale];
	const segments = keyPath.split(".");

	if (segments.length === 0 || segments.some((segment) => segment.length === 0)) {
		throw new Error(`Invalid translation key path: ${keyPath}`);
	}

	let current: unknown = dictionary;

	for (const segment of segments) {
		if (typeof current !== "object" || current === null || Array.isArray(current)) {
			throw new Error(`Missing translation key: ${locale}.${keyPath}`);
		}

		current = (current as Record<string, unknown>)[segment];

		if (current === undefined) {
			throw new Error(`Missing translation key: ${locale}.${keyPath}`);
		}
	}

	return current as TranslationValue;
}

function interpolate(template: string, options: TranslationOptions): string {
	return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
		const value = options[key];

		return value == null ? "" : String(value);
	});
}

export type Translate = {
	(keyPath: string, options?: TranslationOptions): string;
	<T = TranslationValue>(keyPath: string, options: ReturnObjectsTranslationOptions): T;
};

function createTranslator(locale: Lang): Translate {
	return ((keyPath: string, options: TranslationOptions = {}) => {
		let value: TranslationValue;

		try {
			value = lookupTranslation(locale, keyPath);
		} catch (error) {
			if (options.defaultValue !== undefined) {
				return options.defaultValue;
			}

			throw error;
		}

		if (typeof value === "string") {
			return interpolate(value, options);
		}

		if (options.returnObjects) {
			return value;
		}

		throw new Error(`Translation key is not a string: ${locale}.${keyPath}`);
	}) as Translate;
}

export function getTranslations(locale: Lang): Translate {
	return createTranslator(locale);
}

export function t(locale: string | Lang, keyPath: string, options?: TranslationOptions): string;
export function t<T = TranslationValue>(
	locale: string | Lang,
	keyPath: string,
	options: ReturnObjectsTranslationOptions,
): T;
export function t(
	locale: string | Lang,
	keyPath: string,
	options?: TranslationOptions,
): string | TranslationValue {
	return createTranslator(toLang(locale))(keyPath, options as TranslationOptions & ReturnObjectsTranslationOptions);
}
