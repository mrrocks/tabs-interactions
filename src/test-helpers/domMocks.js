export const createClassList = (initialNames = []) => {
  const names = new Set(initialNames);
  return {
    add: (...classNames) => {
      classNames.forEach((name) => names.add(name));
    },
    remove: (...classNames) => {
      classNames.forEach((name) => names.delete(name));
    },
    contains: (className) => names.has(className),
    toggle: (className, force) => {
      if (force === true) {
        names.add(className);
        return true;
      }
      if (force === false) {
        names.delete(className);
        return false;
      }
      if (names.has(className)) {
        names.delete(className);
        return false;
      }
      names.add(className);
      return true;
    }
  };
};
