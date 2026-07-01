// Browser shim for Firebase Firestore optional RE2 import used by some package versions.
// Firestore only checks for availability in browser builds; this app does not call it directly.
export class RE2JS {
  constructor(pattern, flags) { this.pattern = pattern; this.flags = flags; this.regex = new RegExp(pattern, flags); }
  static compile(pattern, flags) { return new RE2JS(pattern, flags); }
  matcher(value) { return { matches: () => this.regex.test(String(value || '')) }; }
  matches(value) { return this.regex.test(String(value || '')); }
  test(value) { return this.regex.test(String(value || '')); }
}
export default { RE2JS };
