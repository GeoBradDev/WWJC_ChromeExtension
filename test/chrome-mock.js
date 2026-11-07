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
export function createChromeMock(initialStorage = {}) {
  const data = structuredClone(initialStorage);
  const onChanged = createEvent();

  function emit(changes) {
    if (Object.keys(changes).length > 0) onChanged.fire(changes, "local");
  }

  const local = {
    data,
    get: vi.fn(async (keys) => {
      const list = keys == null ? Object.keys(data) : [].concat(keys);
      const out = {};
      for (const k of list) {
        if (k in data) out[k] = structuredClone(data[k]);
      }
      return out;
    }),
    set: vi.fn(async (items) => {
      const changes = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: data[k], newValue: structuredClone(v) };
        data[k] = structuredClone(v);
      }
      emit(changes);
    }),
    remove: vi.fn(async (keys) => {
      const changes = {};
      for (const k of [].concat(keys)) {
        if (k in data) {
          changes[k] = { oldValue: data[k] };
          delete data[k];
        }
      }
      emit(changes);
    })
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
