import { objectHash, path } from "./deps.ts";
import { getFileInfo, RecordAny } from "./utils.ts";

export type EventName =
  | "any"
  | "access"
  | "create"
  | "modify"
  | "remove"
  | "other";

interface CustomFsEvent {
  path: string;
  kind: EventName;
  flag?: Deno.FsEventFlag;
}

export interface Context<State extends RecordAny> {
  path: string;
  event: EventName;
  file: Deno.FileInfo | null;
  flag?: Deno.FsEventFlag;
  state: State;
}

export type Next = () => Promise<void>;

export type Middleware<State extends RecordAny> = (
  ctx: Context<State>,
  next: Next,
) => Promise<void> | void;

export interface Options {
  recursive: boolean;
  base: string;
  debounceTime: number | null;
}

const defaultOptions: Options = {
  recursive: true,
  base: Deno.cwd(),
  debounceTime: 50,
};

export class Watcher<State extends RecordAny> {
  paths: string[] = [];
  options: Options;
  #middlewares: Middleware<State>[] = [];
  #debounceTimers = new Map<string, number>();

  constructor(paths?: string | string[], options?: Partial<Options>) {
    this.options = { ...defaultOptions, ...options };
    if (paths) {
      this.addPaths(paths);
    }
  }

  addPaths(paths: string | string[]) {
    const { base } = this.options;
    if (Array.isArray(paths)) {
      const modifiedPaths = paths.map((p) => path.join(base, p));
      this.paths = [...this.paths, ...modifiedPaths];
    } else {
      this.paths.push(path.join(base, paths));
    }
  }

  async watch() {
    if (this.paths.length === 0) {
      throw new Error("No paths provided to watch for");
    }
    const watcher = Deno.watchFs(this.paths, {
      recursive: this.options.recursive,
    });

    for await (const event of watcher) {
      event.paths.forEach(async (path) => {
        const newEvent = {
          path: path,
          kind: event.kind,
          flag: event.flag,
        };

        if (this.options.debounceTime) {
          const key = objectHash(newEvent);

          if (this.#debounceTimers.has(key)) {
            clearTimeout(this.#debounceTimers.get(key));
            this.#debounceTimers.delete(key);
          }

          const newTimer = setTimeout(async () => {
            this.#debounceTimers.delete(key);
            await this.#handleEvent(newEvent);
          }, this.options.debounceTime);

          this.#debounceTimers.set(key, newTimer);
        } else {
          await this.#handleEvent(newEvent);
        }
      });
    }
  }

  async #handleEvent(event: CustomFsEvent) {
    const file = getFileInfo(event.path);
    const eventName = this.#getEventName(event, file);
    const context: Context<State> = {
      path: event.path,
      event: eventName,
      file: file,
      flag: event.flag,
      state: {} as State,
    };
    let prevIndex = -1;

    const next = async (i: number) => {
      if (i <= prevIndex) {
        throw new Error("next() is called multiple times in one middleware");
      }
      const middleware = this.#middlewares[i];
      if (!middleware) {
        return;
      }
      prevIndex = i;

      await middleware(context, next.bind(null, i + 1) as Next);
    };

    await next(0);
  }

  #getEventName(event: CustomFsEvent, file: Deno.FileInfo | null): EventName {
    let eventName = event.kind;

    if (eventName === "modify") {
      if (!file) {
        eventName = "remove";
      }
    }

    return eventName;
  }

  use(fn: Middleware<State>) {
    this.#middlewares.push(fn);
  }
}

