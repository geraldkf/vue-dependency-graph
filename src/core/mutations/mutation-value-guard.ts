const mutationUpdaterGuardsEnabled = import.meta.env.DEV;

class MutationValueMutationError extends Error {
  public constructor() {
    super("Mutation updater attempted to modify the current graph value.");
    this.name = "MutationValueMutationError";
  }
}

const isPlainObject = (value: object): boolean => {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const isProtectedContainer = (value: unknown): value is object =>
  typeof value === "object" && value !== null && (Array.isArray(value) || isPlainObject(value));

interface MutationUpdaterValueGuard {
  readonly current: unknown;
  readonly unwrap: (value: unknown) => unknown;
}

const createProtectedView = (
  value: object,
  sourceToProxy: WeakMap<object, object>,
  proxyToSource: WeakMap<object, object>,
): object => {
  const existing = sourceToProxy.get(value);
  if (existing) return existing;

  const proxyTarget = Array.isArray(value)
    ? [...value]
    : Object.assign(Object.create(Object.getPrototypeOf(value)), value);
  const proxy = new Proxy(proxyTarget, {
    get: (target, property, receiver) => {
      const result = Reflect.get(target, property, receiver);
      return isProtectedContainer(result)
        ? createProtectedView(result, sourceToProxy, proxyToSource)
        : result;
    },
    set: () => {
      throw new MutationValueMutationError();
    },
    deleteProperty: () => {
      throw new MutationValueMutationError();
    },
    defineProperty: () => {
      throw new MutationValueMutationError();
    },
    setPrototypeOf: () => {
      throw new MutationValueMutationError();
    },
  });

  sourceToProxy.set(value, proxy);
  proxyToSource.set(proxy, value);
  return proxy;
};

const unwrapProtectedValue = (
  value: unknown,
  proxyToSource: WeakMap<object, object>,
  visited: WeakMap<object, unknown>,
): unknown => {
  if (typeof value !== "object" || value === null) return value;

  const source = proxyToSource.get(value);
  if (source) return source;

  if (!isProtectedContainer(value)) return value;

  const previous = visited.get(value);
  if (previous !== undefined) return previous;

  if (Array.isArray(value)) {
    const unwrapped: unknown[] = [];
    visited.set(value, unwrapped);
    let changed = false;
    for (const item of value) {
      const unwrappedItem = unwrapProtectedValue(item, proxyToSource, visited);
      changed ||= !Object.is(item, unwrappedItem);
      unwrapped.push(unwrappedItem);
    }
    return changed ? unwrapped : value;
  }

  const prototype = Object.getPrototypeOf(value);
  const unwrapped = Object.create(prototype) as Record<PropertyKey, unknown>;
  visited.set(value, unwrapped);
  let changed = false;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    if ("value" in descriptor) {
      const unwrappedProperty = unwrapProtectedValue(descriptor.value, proxyToSource, visited);
      changed ||= !Object.is(descriptor.value, unwrappedProperty);
      Object.defineProperty(unwrapped, key, {
        ...descriptor,
        value: unwrappedProperty,
      });
    } else {
      Object.defineProperty(unwrapped, key, descriptor);
    }
  }
  return changed ? unwrapped : value;
};

export const guardMutationUpdaterValue = (current: unknown): MutationUpdaterValueGuard => {
  if (!mutationUpdaterGuardsEnabled || !isProtectedContainer(current)) {
    return { current, unwrap: (value) => value };
  }

  const sourceToProxy = new WeakMap<object, object>();
  const proxyToSource = new WeakMap<object, object>();
  return {
    current: createProtectedView(current, sourceToProxy, proxyToSource),
    unwrap: (value) => unwrapProtectedValue(value, proxyToSource, new WeakMap()),
  };
};

export const isMutationValueMutationError = (error: unknown): error is MutationValueMutationError =>
  error instanceof MutationValueMutationError;
