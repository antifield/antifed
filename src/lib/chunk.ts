// Splits an array into consecutive groups of at most `size` items. Returns an
// empty array when given no items.
export function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new RangeError(`chunk size must be >= 1, got ${size}`);
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    groups.push(items.slice(i, i + size));
  }
  return groups;
}
