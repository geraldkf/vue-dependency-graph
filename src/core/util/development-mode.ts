// Deliberately not `import.meta.env.DEV`: that expression only exists under
// Vite, and this package is also consumed through other bundlers and test
// runners where `import.meta.env` is undefined, which would throw when the
// module loads. `process.env.NODE_ENV` is the convention every bundler
// statically replaces in production builds, so the `=== "production"`
// comparison still folds away there; where `process` doesn't exist at all
// (plain browser ESM) the lookup throws and development checks stay on.
declare const process: { readonly env: { readonly NODE_ENV?: string } };

export const isDevelopmentBuild = (): boolean => {
  try {
    return process.env.NODE_ENV !== "production";
  } catch {
    return true;
  }
};
