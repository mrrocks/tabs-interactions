export const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);

export const toFiniteNumber = (value, fallbackValue = 0) => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : fallbackValue;
};
