export const getFileInfo = (path: string) => {
  try {
    return Deno.statSync(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return null;
    } else {
      throw err;
    }
  }
};

// deno-lint-ignore no-explicit-any
export type RecordAny = Record<string, any>;
