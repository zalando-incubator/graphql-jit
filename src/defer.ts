export function defer<T>(f: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        resolve(f());
      } catch (e) {
        reject(e);
      }
    });
  });
}
