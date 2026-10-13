// from https://stackoverflow.com/questions/3942878/how-to-decide-font-color-in-white-or-black-depending-on-background-color
// The advanced version adheres to the WCAG 2.0 standard for contrast ratio
// The simple version is sort of a "weighted average" but yields a slightly better result

// light color is gray.50, dark color is gray.900
export const pickTextColorBasedOnBgColorAdvanced = (bgColor: string, lightColor = '#F7FAFC', darkColor = '#171923') => {
  const color = bgColor.startsWith('#') ? bgColor.substring(1, 7) : bgColor;
  const r = Number.parseInt(color.substring(0, 2), 16); // hexToR
  const g = Number.parseInt(color.substring(2, 4), 16); // hexToG
  const b = Number.parseInt(color.substring(4, 6), 16); // hexToB
  const uicolors = [r / 255, g / 255, b / 255];
  const c = uicolors.map((col) => {
    if (col <= 0.03928) {
      return col / 12.92;
    }
    return Math.pow((col + 0.055) / 1.055, 2.4);
  });
  const L = 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  return L > 0.179 ? darkColor : lightColor;
};

// the original delta is 186, but I find that 150 is a better threshold
// light color is gray.50, dark color is gray.900
export const pickTextColorBasedOnBgColorSimple = (bgColor: string, lightColor = '#F7FAFC', darkColor = '#171923') => {
  const color = bgColor.startsWith('#') ? bgColor.substring(1, 7) : bgColor;
  const r = Number.parseInt(color.substring(0, 2), 16); // hexToR
  const g = Number.parseInt(color.substring(2, 4), 16); // hexToG
  const b = Number.parseInt(color.substring(4, 6), 16); // hexToB
  return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? darkColor : lightColor;
};
