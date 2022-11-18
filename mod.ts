import {
  anymatch,
  EventEmitter,
  Matcher,
  objectHash,
  TypedEmitter,
} from "./deps.ts";
import { getFileInfo } from "./utils.ts";

export type EventKind =
  | "any"
  | "access"
  | "create"
  | "modify"
  | "remove"
  | "other";

interface CustomFsEvent {
  path: string;
  kind: EventKind;
  flag?: Deno.FsEventFlag;
}

export interface Context {
  path: string;
  event: EventKind;
  file: Deno.FileInfo | null;
  flag?: Deno.FsEventFlag;
}

export interface Options {
  recursive: boolean;
  debounceTime: number | null;
  ignore?: Matcher;
}

const defaultOptions: Options = {
  recursive: true,
  debounceTime: 50,
};

type TypedEvents = {
  [event in EventKind]: (ctx: Context) => void;
};

export class Watcher
  extends (EventEmitter as new () => TypedEmitter<TypedEvents>) {
  paths: string[] = [];
  options: Options;
  #debounceTimers = new Map<string, number>();

  constructor(paths?: string | string[], options?: Partial<Options>) {
    super();
    this.options = { ...defaultOptions, ...options };
    if (paths) {
      this.addPaths(paths);
    }
  }

  addPaths(paths: string | string[]) {
    if (Array.isArray(paths)) {
      this.paths = [...this.paths, ...paths];
    } else {
      this.paths.push(paths);
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
      event.paths.forEach((path) => {
        if (this.options.ignore && anymatch(this.options.ignore, path)) {
          return;
        }

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

          const newTimer = setTimeout(() => {
            this.#debounceTimers.delete(key);
            this.#handleRawEvent(newEvent);
          }, this.options.debounceTime);

          this.#debounceTimers.set(key, newTimer);
        } else {
          this.#handleRawEvent(newEvent);
        }
      });
    }
  }

  #handleRawEvent(event: CustomFsEvent) {
    const file = getFileInfo(event.path);
    const resolvedEvent = this.#resolveEvent(event, file);
    const context: Context = {
      path: event.path,
      event: resolvedEvent,
      file: file,
      flag: event.flag,
    };

    this.emit(resolvedEvent, context);
  }

  #resolveEvent(event: CustomFsEvent, file: Deno.FileInfo | null): EventKind {
    let eventName = event.kind;

    if (eventName === "modify") {
      if (!file) {
        eventName = "remove";
      }
    }

    return eventName;
  }
}
