export const createSingleFlight = () => {
  const pending = new Map();

  const run = async (key, operation) => {
    const activeOperation = pending.get(key);
    if (activeOperation) {
      return {
        value: await activeOperation,
        shared: true,
      };
    }

    const promise = Promise.resolve().then(operation);
    pending.set(key, promise);

    try {
      return {
        value: await promise,
        shared: false,
      };
    } finally {
      if (pending.get(key) === promise) {
        pending.delete(key);
      }
    }
  };

  return {
    run,
    size: () => pending.size,
  };
};
