const appendSign = (
  value: string | number,
  isPositiveGood = true,
  hasNegativeSignByDefault = false,
) => {
  const numVal = Number(value);
  if ((isPositiveGood && numVal > 0) || (!isPositiveGood && numVal < 0)) {
    return `+${numVal}`;
  }
  if (
    !hasNegativeSignByDefault &&
    ((!isPositiveGood && numVal > 0) || (isPositiveGood && numVal < 0))
  ) {
    return `-${numVal}`;
  }
  return `${numVal}`;
};

export default appendSign;
