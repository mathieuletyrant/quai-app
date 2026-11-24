/**
 * The pairing link with this console's address added (`console=…`), for the app's "Open the
 * console": the link comes from Quai Cloud, which serves no console and doesn't know Quai Home's
 * address from outside. The address the console was opened with is the one that works.
 */
export const withConsoleAddress = (link: string, origin: string): string =>
  `${link}${link.includes("?") ? "&" : "?"}console=${encodeURIComponent(origin)}`
