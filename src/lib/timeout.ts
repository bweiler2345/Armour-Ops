// Gives up waiting on a request after a time limit, so a screen never waits
// forever on a request that failed or never returned.

export class TimeoutError extends Error {
  constructor() {
    super("Timed out");
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
