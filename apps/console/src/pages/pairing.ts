/**
 * The pairing link with the console's addresses (`console=…`), for the app's "Open the console":
 * the link comes from Quai Cloud, which serves no console. First the address the console was
 * opened at, then Quai Home's public one (`QUAI_CONSOLE_PUBLIC_URL`) when it's another: the app
 * opens the first that answers, so the local one at home and the public one when out.
 */
export const withConsoleAddresses = (link: string, origin: string, publicUrl: string | undefined): string => {
  const addresses = [origin, ...(publicUrl === undefined ? [] : [publicUrl])]
    .map((url) => url.replace(/\/+$/, ""))
    .filter((url, index, all) => all.indexOf(url) === index)
  const params = addresses.map((url) => `console=${encodeURIComponent(url)}`).join("&")
  return `${link}${link.includes("?") ? "&" : "?"}${params}`
}
