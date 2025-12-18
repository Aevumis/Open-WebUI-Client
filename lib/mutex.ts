/**
 * Mutex implementation to prevent race conditions in concurrent operations
 */

const locks = new Map<string, Promise<void>>();

/**
 * Acquires an exclusive lock for a specific key.
 * @param key - The key to lock
 * @param timeoutMs - Timeout in milliseconds before rejecting
 * @returns Promise that resolves to a release function
 */
export async function acquireLock(key: string, timeoutMs: number): Promise<() => void> {
  // Wait for any existing lock on this key
  if (locks.has(key)) {
    await locks.get(key);
  }

  let releaseLock: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = () => {
      locks.delete(key);
      resolve();
    };
  });

  locks.set(key, lockPromise);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      locks.delete(key);
      reject(new Error(`Lock timeout for key: \${key}`));
    }, timeoutMs);
  });

  return Promise.race([Promise.resolve(releaseLock!), timeoutPromise]);
}

/**
 * Wraps a function with locking to ensure atomic operations.
 * @param key - The key to lock
 * @param timeoutMs - Timeout in milliseconds
 * @param fn - The async function to execute while holding the lock
 * @returns Promise that resolves with the function's result
 */
export async function withLock<T>(
  key: string,
  timeoutMs: number,
  fn: () => Promise<T>
): Promise<T> {
  const releaseLock = await acquireLock(key, timeoutMs);
  try {
    return await fn();
  } finally {
    releaseLock();
  }
}
