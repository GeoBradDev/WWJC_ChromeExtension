import { vi } from "vitest";

// Minimal listener registry matching chrome.events.Event.
function createEvent() {
  const listeners = [];
  return {
    listeners,
    addListener: vi.fn((fn) => {
      listeners.push(fn);
    }),
    removeListener: vi.fn((fn) => {
      const i = listeners.indexOf(fn);
      if (i !== -1) listeners.splice(i, 1);
    }),
    fire(...args) {
      return listeners.map((fn) => fn(...args));
    }
  };
}

// Hand-written chrome mock: in-memory storage.local (promise style) that
// fires storage.onChanged, plus the extension APIs the code under test uses.
//
// With { deferred: true }, storage operations do not run when called: they
// wait in storage.local.queue (in call order) until the test runs them with
// storage.local.step() (one) or storage.local.flush() (all queued so far).
// Each operation reads or writes the data at the moment it runs, which lets
// tests interleave storage round trips like a real async storage backend.
export function createChromeMock(initialStorage = {}, { deferred = false } = {}) {
  const data = structuredClone(initialStorage);
  const onChanged = createEvent();
  const queue = [];

  function run(name, op) {
    if (!deferred) return (async () => op())();
    return new Promise((resolve, reject) => {
      queue.push({
        name,
        exec() {
          try {
            resolve(op());
          } catch (err) {
            reject(err);
          }
        }
      });
    });
  }

  function emit(changes) {
    if (Object.keys(changes).length > 0) onChanged.fire(changes, "local");
  }

  const local = {
    data,
    queue,
    step() {
      const op = queue.shift();
      if (op) op.exec();
      return op ? op.name : null;
    },
    flush() {
      const ops = queue.splice(0, queue.length);
      for (const op of ops) op.exec();
      return ops.map((op) => op.name);
    },
    get: vi.fn((keys) => run("get", () => {
      const list = keys == null ? Object.keys(data) : [].concat(keys);
      const out = {};
      for (const k of list) {
        if (k in data) out[k] = structuredClone(data[k]);
      }
      return out;
    })),
    set: vi.fn((items) => run("set", () => {
      const changes = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: data[k], newValue: structuredClone(v) };
        data[k] = structuredClone(v);
      }
      emit(changes);
    })),
    remove: vi.fn((keys) => run("remove", () => {
      const changes = {};
      for (const k of [].concat(keys)) {
        if (k in data) {
          changes[k] = { oldValue: data[k] };
          delete data[k];
        }
      }
      emit(changes);
    }))
  };

  return {
    storage: { local, onChanged },
    notifications: { create: vi.fn() },
    action: { setBadgeText: vi.fn(async () => {}) },
    runtime: {
      getPlatformInfo: vi.fn(async () => ({ os: "linux", arch: "x86-64" })),
      onInstalled: createEvent(),
      onStartup: createEvent()
    },
    contextMenus: {
      create: vi.fn(),
      onClicked: createEvent()
    }
  };
}
