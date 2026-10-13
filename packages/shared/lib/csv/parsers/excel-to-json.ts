import * as XLSX from 'xlsx';
import type { Readable } from 'stream';

const parseExcel = (file: Buffer | Uint8Array | Blob | string | Readable) =>
  new Promise((resolve, reject) => {
    const parsingOpts: XLSX.ParsingOptions = {
      cellDates: true,
      type: 'buffer',
    };
    const workBook = XLSX.read(file, parsingOpts);
    const firstSheetName = workBook.SheetNames[0];
    if (!firstSheetName) {
      return reject(new Error('No sheet found in the file'));
    }
    const firstSheet = workBook.Sheets[firstSheetName];
    if (!firstSheet) {
      return reject(new Error('No sheet found in the file'));
    }
    const conversionOpts: XLSX.Sheet2JSONOpts = {
      header: 1,
      range: 0,
      defval: null,
    };
    const jsonData = XLSX.utils.sheet_to_json(firstSheet, conversionOpts);
    if (!jsonData || jsonData.length === 0) {
      return reject(new Error('No data found in the file'));
    }
    return resolve(jsonData);
  });

export default parseExcel;
