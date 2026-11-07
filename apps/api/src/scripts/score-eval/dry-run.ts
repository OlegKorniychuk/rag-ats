/** Counts the bullet lines ("- ..." or "* ...") of a vacancy's requirements. */
export function countRequirements(requirements: string): number {
  return requirements.split('\n').filter((l) => /^\s*[-*]\s+\S/.test(l)).length;
}
