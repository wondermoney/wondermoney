// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import type { Dictionary, EntityManager } from '@mikro-orm/core';

import { Currency } from '@entity/Currency';
import { Seeder } from '@mikro-orm/seeder';

export class CurrencySeeder extends Seeder {
  async run(em: EntityManager, ctx: Dictionary): Promise<void> {
    const ctxCurrencyEntities = [];
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'CHF', decimalDigits: 2, description: 'Swiss franc', isActive: true, num: '756' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'GYD', decimalDigits: 2, description: 'Guyanese dollar', num: '328' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'SDG', decimalDigits: 2, description: 'Sudanese pound', num: '938' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'BSD', decimalDigits: 2, description: 'Bahamian dollar', num: '44' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'IDR', decimalDigits: 2, description: 'Indonesian rupiah', num: '360' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'AED', decimalDigits: 2, description: 'United Arab Emirates dirham', num: '784' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'SZL', decimalDigits: 2, description: 'Swazi lilangeni', num: '748' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'KMF', decimalDigits: 0, description: 'Comoro franc', num: '174' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'SBD', decimalDigits: 2, description: 'Solomon Islands dollar', num: '90' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'SAR', decimalDigits: 2, description: 'Saudi riyal', num: '682' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'IQD', decimalDigits: 3, description: 'Iraqi dinar', num: '368' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'YER', decimalDigits: 2, description: 'Yemeni rial', num: '886' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'GIP', decimalDigits: 2, description: 'Gibraltar pound', num: '292' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'NZD', decimalDigits: 2, description: 'New Zealand dollar', num: '554' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'PYG', decimalDigits: 0, description: 'Paraguayan guaranÃ', num: '600' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'MDL', decimalDigits: 2, description: 'Moldovan leu', num: '498' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'IRR', decimalDigits: 2, description: 'Iranian rial', num: '364' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'MMK', decimalDigits: 2, description: 'Myanmar kyat', num: '104' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'CLF', decimalDigits: 4, description: 'Unidad de Fomento (funds code)', num: '990' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'LKR', decimalDigits: 2, description: 'Sri Lankan rupee', num: '144' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'RWF', decimalDigits: 0, description: 'Rwandan franc', num: '646' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'LRD', decimalDigits: 2, description: 'Liberian dollar', num: '430' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'XAG', decimalDigits: 2, description: 'Silver (one troy ounce)', num: '961' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'JPY', decimalDigits: 0, description: 'Japanese yen', isActive: true, num: '392' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'HRK', decimalDigits: 2, description: 'Croatian kuna', num: '191' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'ALL', decimalDigits: 2, description: 'Albanian lek', num: '8' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, {
        code: 'COU',
        decimalDigits: 2,
        description: 'Unidad de Valor Real (UVR) (funds code)[8]',
        num: '970',
      }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'MNT', decimalDigits: 2, description: 'Mongolian tÃ¶grÃ¶g', num: '496' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'DKK', decimalDigits: 2, description: 'Danish krone', isActive: true, num: '208' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'MRU', decimalDigits: 2, description: 'Mauritanian ouguiya', num: '929' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'KES', decimalDigits: 2, description: 'Kenyan shilling', num: '404' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'DOP', decimalDigits: 2, description: 'Dominican peso', num: '214' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, {
        code: 'AUD',
        decimalDigits: 2,
        description: 'Australian dollar',
        isActive: true,
        num: '36',
      }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'TWD', decimalDigits: 2, description: 'New Taiwan dollar', num: '901' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'BGN', decimalDigits: 2, description: 'Bulgarian lev', num: '975' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'TRY', decimalDigits: 2, description: 'Turkish lira', num: '949' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'KYD', decimalDigits: 2, description: 'Cayman Islands dollar', num: '136' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'EGP', decimalDigits: 2, description: 'Egyptian pound', num: '818' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'AWG', decimalDigits: 2, description: 'Aruban florin', num: '533' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, {
        code: 'XBD',
        decimalDigits: 2,
        description: 'European Unit of Account 17 (E.U.A.-17) (bond market unit)',
        num: '958',
      }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'XPT', decimalDigits: 2, description: 'Platinum (one troy ounce)', num: '962' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, {
        code: 'HUF',
        decimalDigits: 2,
        description: 'Hungarian forint',
        isActive: true,
        num: '348',
      }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'PKR', decimalDigits: 2, description: 'Pakistani rupee', num: '586' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'LBP', decimalDigits: 2, description: 'Lebanese pound', num: '422' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'SLL', decimalDigits: 2, description: 'Sierra Leonean leone', num: '694' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'GEL', decimalDigits: 2, description: 'Georgian lari', num: '981' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'XDR', decimalDigits: 2, description: 'Special drawing rights', num: '960' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'AZN', decimalDigits: 2, description: 'Azerbaijani manat', num: '944' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'XAF', decimalDigits: 0, description: 'CFA franc BEAC', num: '950' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'TTD', decimalDigits: 2, description: 'Trinidad and Tobago dollar', num: '780' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'JMD', decimalDigits: 2, description: 'Jamaican dollar', num: '388' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, {
        code: 'CAD',
        decimalDigits: 2,
        description: 'Canadian dollar',
        isActive: true,
        num: '124',
      }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'LAK', decimalDigits: 2, description: 'Lao kip', num: '418' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'VND', decimalDigits: 0, description: 'Vietnamese Ä`á»“ng', num: '704' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'BND', decimalDigits: 2, description: 'Brunei dollar', num: '96' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'ZAR', decimalDigits: 2, description: 'South African rand', num: '710' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'GNF', decimalDigits: 0, description: 'Guinean franc', num: '324' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'XOF', decimalDigits: 0, description: 'CFA franc BCEAO', num: '952' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'BYN', decimalDigits: 2, description: 'Belarusian ruble', num: '933' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'SVC', decimalDigits: 2, description: 'Salvadoran colÃ³n', num: '222' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'LYD', decimalDigits: 3, description: 'Libyan dinar', num: '434' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'GHS', decimalDigits: 2, description: 'Ghanaian cedi', num: '936' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'CUC', decimalDigits: 2, description: 'Cuban convertible peso', num: '931' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'KZT', decimalDigits: 2, description: 'Kazakhstani tenge', num: '398' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'UAH', decimalDigits: 2, description: 'Ukrainian hryvnia', num: '980' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'SSP', decimalDigits: 2, description: 'South Sudanese pound', num: '728' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'QAR', decimalDigits: 2, description: 'Qatari riyal', num: '634' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'SRD', decimalDigits: 2, description: 'Surinamese dollar', num: '968' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, {
        code: 'USD',
        decimalDigits: 2,
        description: 'United States dollar',
        isActive: true,
        num: '840',
      }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'SOS', decimalDigits: 2, description: 'Somali shilling', num: '706' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, {
        code: 'MXV',
        decimalDigits: 2,
        description: 'Mexican Unidad de Inversion (UDI) (funds code)',
        num: '979',
      }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'CVE', decimalDigits: 2, description: 'Cape Verdean escudo', num: '132' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'CRC', decimalDigits: 2, description: 'Costa Rican colon', num: '188' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'RSD', decimalDigits: 2, description: 'Serbian dinar', num: '941' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'XCD', decimalDigits: 2, description: 'East Caribbean dollar', num: '951' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'MWK', decimalDigits: 2, description: 'Malawian kwacha', num: '454' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'BBD', decimalDigits: 2, description: 'Barbados dollar', num: '52' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, {
        code: 'XBA',
        decimalDigits: 2,
        description: 'European Composite Unit (EURCO) (bond market unit)',
        num: '955',
      }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'HTG', decimalDigits: 2, description: 'Haitian gourde', num: '332' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'WST', decimalDigits: 2, description: 'Samoan tala', num: '882' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'BZD', decimalDigits: 2, description: 'Belize dollar', num: '84' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'ARS', decimalDigits: 2, description: 'Argentine peso', num: '32' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'FKP', decimalDigits: 2, description: 'Falkland Islands pound', num: '238' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'GMD', decimalDigits: 2, description: 'Gambian dalasi', num: '270' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'AMD', decimalDigits: 2, description: 'Armenian dram', num: '51' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'SCR', decimalDigits: 2, description: 'Seychelles rupee', num: '690' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'ISK', decimalDigits: 0, description: 'Icelandic krÃ³na', num: '352' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'PHP', decimalDigits: 2, description: 'Philippine peso[12]', num: '608' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'UGX', decimalDigits: 0, description: 'Ugandan shilling', num: '800' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'LSL', decimalDigits: 2, description: 'Lesotho loti', num: '426' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'BIF', decimalDigits: 0, description: 'Burundian franc', num: '108' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'SYP', decimalDigits: 2, description: 'Syrian pound', num: '760' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'CZK', decimalDigits: 2, description: 'Czech koruna', num: '203' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'ETB', decimalDigits: 2, description: 'Ethiopian birr', num: '230' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'NGN', decimalDigits: 2, description: 'Nigerian naira', num: '566' }),
    );
    ctxCurrencyEntities.push(em.create(Currency, { code: 'XSU', decimalDigits: 2, description: 'SUCRE', num: '994' }));
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'RUB', decimalDigits: 2, description: 'Russian ruble', num: '643' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'COP', decimalDigits: 2, description: 'Colombian peso', num: '170' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'CNY', decimalDigits: 2, description: 'Chinese yuan[7]', num: '156' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'PEN', decimalDigits: 2, description: 'Peruvian sol', num: '604' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'TZS', decimalDigits: 2, description: 'Tanzanian shilling', num: '834' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'SHP', decimalDigits: 2, description: 'Saint Helena pound', num: '654' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, {
        code: 'UYI',
        decimalDigits: 0,
        description: 'Uruguay Peso en Unidades Indexadas (URUIURUI) (funds code)',
        num: '940',
      }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'GTQ', decimalDigits: 2, description: 'Guatemalan quetzal', num: '320' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'BDT', decimalDigits: 2, description: 'Bangladeshi taka', num: '50' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'XAU', decimalDigits: 2, description: 'Gold (one troy ounce)', num: '959' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'THB', decimalDigits: 2, description: 'Thai baht', num: '764' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'FJD', decimalDigits: 2, description: 'Fiji dollar', num: '242' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'KGS', decimalDigits: 2, description: 'Kyrgyzstani som', num: '417' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'CLP', decimalDigits: 0, description: 'Chilean peso', num: '152' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'MKD', decimalDigits: 2, description: 'Macedonian denar', num: '807' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'BWP', decimalDigits: 2, description: 'Botswana pula', num: '72' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, {
        code: 'SEK',
        decimalDigits: 2,
        description: 'Swedish krona/kronor',
        isActive: true,
        num: '752',
      }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'DJF', decimalDigits: 0, description: 'Djiboutian franc', num: '262' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'ZMW', decimalDigits: 2, description: 'Zambian kwacha', num: '967' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'ZWL', decimalDigits: 2, description: 'Zimbabwean dollar', num: '932' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'BHD', decimalDigits: 3, description: 'Bahraini dinar', num: '48' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'UYW', decimalDigits: 4, description: 'Unidad previsional[14]', num: '927' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'KPW', decimalDigits: 2, description: 'North Korean won', num: '408' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'KWD', decimalDigits: 3, description: 'Kuwaiti dinar', num: '414' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'XTS', decimalDigits: 2, description: 'Code reserved for testing', num: '963' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'STN', decimalDigits: 2, description: 'São Tomé e Príncipe dobra', num: '930' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'UZS', decimalDigits: 2, description: 'Uzbekistan som', num: '860' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'BTN', decimalDigits: 2, description: 'Bhutanese ngultrum', num: '64' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'UYU', decimalDigits: 2, description: 'Uruguayan peso', num: '858' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, {
        code: 'XBC',
        decimalDigits: 2,
        description: 'European Unit of Account 9 (E.U.A.-9) (bond market unit)',
        num: '957',
      }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'CDF', decimalDigits: 2, description: 'Congolese franc', num: '976' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'PAB', decimalDigits: 2, description: 'Panamanian balboa', num: '590' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, {
        code: 'XBB',
        decimalDigits: 2,
        description: 'European Monetary Unit (E.M.U.-6) (bond market unit)',
        num: '956',
      }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'INR', decimalDigits: 2, description: 'Indian rupee', num: '356' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'HKD', decimalDigits: 2, description: 'Hong Kong dollar', num: '344' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'AOA', decimalDigits: 2, description: 'Angolan kwanza', num: '973' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'BRL', decimalDigits: 2, description: 'Brazilian real', isActive: true, num: '986' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'MAD', decimalDigits: 2, description: 'Moroccan dirham', num: '504' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'NPR', decimalDigits: 2, description: 'Nepalese rupee', num: '524' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'ANG', decimalDigits: 2, description: 'Netherlands Antillean guilder', num: '532' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'KHR', decimalDigits: 2, description: 'Cambodian riel', num: '116' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'MGA', decimalDigits: 2, description: 'Malagasy ariary', num: '969' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'TND', decimalDigits: 3, description: 'Tunisian dinar', num: '788' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'MVR', decimalDigits: 2, description: 'Maldivian rufiyaa', num: '462' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'TMT', decimalDigits: 2, description: 'Turkmenistan manat', num: '934' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'KRW', decimalDigits: 0, description: 'South Korean won', num: '410' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'MOP', decimalDigits: 2, description: 'Macanese pataca', num: '446' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'MYR', decimalDigits: 2, description: 'Malaysian ringgit', num: '458' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'SGD', decimalDigits: 2, description: 'Singapore dollar', num: '702' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, {
        code: 'NOK',
        decimalDigits: 2,
        description: 'Norwegian krone',
        isActive: true,
        num: '578',
      }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'ILS', decimalDigits: 2, description: 'Israeli new shekel', num: '376' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, {
        code: 'CHW',
        decimalDigits: 2,
        description: 'WIR Franc (complementary currency)',
        num: '948',
      }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, {
        code: 'BAM',
        decimalDigits: 2,
        description: 'Bosnia and Herzegovina convertible mark',
        num: '977',
      }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'HNL', decimalDigits: 2, description: 'Honduran lempira', num: '340' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'EUR', decimalDigits: 2, description: 'Euro', isActive: true, num: '978' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'AFN', decimalDigits: 2, description: 'Afghan afghani', num: '971' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'RON', decimalDigits: 2, description: 'Romanian leu', num: '946' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'PGK', decimalDigits: 2, description: 'Papua New Guinean kina', num: '598' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'BMD', decimalDigits: 2, description: 'Bermudian dollar', num: '60' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'BOB', decimalDigits: 2, description: 'Boliviano', num: '68' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'XPD', decimalDigits: 2, description: 'Palladium (one troy ounce)', num: '964' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'DZD', decimalDigits: 2, description: 'Algerian dinar', num: '12' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'PLN', decimalDigits: 2, description: 'Polish zÅ,oty', num: '985' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'GBP', decimalDigits: 2, description: 'Pound sterling', isActive: true, num: '826' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'VUV', decimalDigits: 0, description: 'Vanuatu vatu', num: '548' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'MXN', decimalDigits: 2, description: 'Mexican peso', num: '484' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'TJS', decimalDigits: 2, description: 'Tajikistani somoni', num: '972' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'MZN', decimalDigits: 2, description: 'Mozambican metical', num: '943' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'XPF', decimalDigits: 0, description: 'CFP franc (franc Pacifique)', num: '953' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, {
        code: 'USN',
        decimalDigits: 2,
        description: 'United States dollar (next day) (funds code)',
        num: '997',
      }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'BOV', decimalDigits: 2, description: 'Bolivian Mvdol (funds code)', num: '984' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'XXX', decimalDigits: 2, description: 'No currency', num: '999' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'NIO', decimalDigits: 2, description: 'Nicaraguan cÃ³rdoba', num: '558' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'JOD', decimalDigits: 3, description: 'Jordanian dinar', num: '400' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'NAD', decimalDigits: 2, description: 'Namibian dollar', num: '516' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'MUR', decimalDigits: 2, description: 'Mauritian rupee', num: '480' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'TOP', decimalDigits: 2, description: 'Tongan paÊ»anga', num: '776' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'CUP', decimalDigits: 2, description: 'Cuban peso', num: '192' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'ERN', decimalDigits: 2, description: 'Eritrean nakfa', num: '232' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'OMR', decimalDigits: 3, description: 'Omani rial', num: '512' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'XUA', decimalDigits: 2, description: 'ADB Unit of Account', num: '965' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'VES', decimalDigits: 2, description: 'Venezuelan bolívar soberano', num: '928' }),
    );
    ctxCurrencyEntities.push(
      em.create(Currency, { code: 'CHE', decimalDigits: 2, description: 'WIR Euro', num: '947' }),
    );
    ctx.currencies = ctxCurrencyEntities;
  }
}
