// PII helpers: masking for display/transport and escaping for HTML contexts.

/**
 * Masks an email for display: "rachit@gmail.com" -> "ra•••@g•••.com".
 * Keeps just enough to be recognizable without disclosing the address.
 */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "•••";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const domainName = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";
  const mask = (s: string, keep: number) =>
    (s.length <= keep ? s.slice(0, 1) : s.slice(0, keep)) + "•••";
  return `${mask(local, 2)}@${mask(domainName, 1)}${tld}`;
}

/** True if a string looks like it contains a raw email address. */
export function looksLikeEmail(s: string): boolean {
  return s.includes("@");
}

/** Escapes a string for safe interpolation into HTML (e.g. email bodies). */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}
