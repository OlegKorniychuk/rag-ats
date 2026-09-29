const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
});

export function formatDate(iso: string): string {
  return dateFormatter.format(new Date(iso));
}
