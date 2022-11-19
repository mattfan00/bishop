import {
  anymatch,
  EventEmitter,
  Matcher,
  objectHash,
  TypedEmitter,
} from "./deps.ts";
import { getFileInfo } from "./utils.ts";

export type DenoFsEventKind =
  | "any"
  | "access"
  | "create"
  | "modify"
  | "remove"
  | "other";

interface CustomDenoFsEvent {
  path: string;
  kind: DenoFsEventKind;
  flag?: Deno.FsEventFlag;
}

export enum EventKind {
  create = "create",
  modify = "modify",
  remove = "remove",
  other = "other",
}

export interface WatcherEvent {
  path: string;
  kind: EventKind;
  file: Deno.FileInfo | null;
  raw: {
    kind: DenoFsEventKind;
    flag?: Deno.FsEventFlag;
  };
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
  ready: () => void;
  event: (event: WatcherEvent) => void;
  error: (err: Error) => void;
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

    this.emit("ready");

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

  #handleRawEvent(event: CustomDenoFsEvent) {
    const file = getFileInfo(event.path);
    const resolvedEventKind = this.#resolveEventKind(event, file);
    const watcherEvent: WatcherEvent = {
      path: event.path,
      kind: resolvedEventKind,
      file: file,
      raw: {
        kind: event.kind,
        flag: event.flag,
      },
    };

    this.emit("event", watcherEvent);
  }

  #resolveEventKind(
    event: CustomDenoFsEvent,
    file: Deno.FileInfo | null,
  ): EventKind {
    if (event.kind === "create") {
      return EventKind.create;
    }

    if (event.kind === "modify") {
      if (file) {
        return EventKind.modify;
      } else {
        return EventKind.remove;
      }
    }

    if (event.kind === "remove") {
      return EventKind.remove;
    }

    return EventKind.other;
  }
}
