const LOCAL_ORIGIN = "https://hive.invalid";

export function safeReturnTo(value: unknown) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return "/";
  }

  try {
    const url = new URL(value, LOCAL_ORIGIN);
    // Dot segments and control characters can normalize into a protocol-relative URL.
    if (url.origin !== LOCAL_ORIGIN || url.pathname.startsWith("//")) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
