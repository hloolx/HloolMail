export function normalizeDomainInput(value: string) {
  return value.trim().toLowerCase().replace(/^\*\./, '').replace(/^\*/, '').replace(/^\.+|\.+$/g, '');
}

export function domainInputWantsWildcard(value: string) {
  return value.trim().startsWith('*');
}
