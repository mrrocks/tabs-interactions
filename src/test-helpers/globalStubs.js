export const stubBrowserGlobals = () => {
  const saved = {
    window: globalThis.window,
    document: globalThis.document,
    Element: globalThis.Element
  };
  return {
    apply(windowStub, documentStub, ElementStub) {
      globalThis.window = windowStub;
      globalThis.document = documentStub;
      globalThis.Element = ElementStub;
    },
    restore() {
      globalThis.window = saved.window;
      globalThis.document = saved.document;
      globalThis.Element = saved.Element;
    }
  };
};
