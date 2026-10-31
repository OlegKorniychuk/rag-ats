interface Criteria {
  title: string;
  requirements: string;
}

// Same normalisation as the server's criteria hash
// (apps/api/src/scoring/criteria-hash.ts): collapse whitespace, trim,
// case-sensitive.
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function changesCriteria(before: Criteria, after: Criteria): boolean {
  return (
    collapse(before.title) !== collapse(after.title) ||
    collapse(before.requirements) !== collapse(after.requirements)
  );
}
