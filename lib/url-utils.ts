/**
 * Safely extracts the host from a URL string
 * @param url - The URL string to parse
 * @returns The host string or null if invalid
 */
export function safeGetHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * Safely parses a URL string
 * @param url - The URL string to parse
 * @returns URL object or null if invalid
 */
export function safeParseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * Validates if a string is a valid URL
 * @param url - The URL string to validate
 * @returns true if valid, false otherwise
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}
