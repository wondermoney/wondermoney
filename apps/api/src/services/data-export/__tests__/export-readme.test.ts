import { describe, expect, it } from 'vitest';

import { ENCRYPTED_EXPORT_README } from '../export-format';

/*
 * The README of a protected export is the one file a person reads before they can open the
 * archive, in every language the app speaks. Spanish copy addresses the reader as "tú"
 * ("Ábrelo", "introduce la contraseña que elegiste"), never as "usted" ("Ábralo", "introduzca",
 * "eligió"), like the rest of the app.
 */
const FORMAL_SPANISH = [
  /(?<!\p{L})ustede?s?(?!\p{L})/iu,
  /(?<!\p{L})(?:ábralo|ábrala|abra|introduzca|inicie|elija|eligió|escriba|guarde|pulse|haga|vuelva|use|utilice|descargue|espere)(?!\p{L})/iu,
];

const sections = ENCRYPTED_EXPORT_README.split(/\n-{3,}\n/).map((section) => section.trim());

describe('the protected export README', () => {
  it('addresses a Spanish reader as tú', () => {
    const spanish = sections.find((section) => section.startsWith('Exportación'));
    expect(spanish).toBeDefined();
    expect(FORMAL_SPANISH.filter((pattern) => pattern.test(spanish ?? '')).map(String)).toEqual([]);
  });
});
