// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installBrowserTranslationDomCompatibility } from "./browser-translation-compat";

const INSTALLATION_KEY = Symbol.for("bap.browser-translation-dom-compatibility");

type NodePrototypeWithInstallation = Node & {
  [INSTALLATION_KEY]?: {
    insertBefore: typeof Node.prototype.insertBefore;
    removeChild: typeof Node.prototype.removeChild;
  };
};

function restoreNativeDomMethods() {
  const nodePrototype = Node.prototype as NodePrototypeWithInstallation;
  const installation = nodePrototype[INSTALLATION_KEY];
  if (!installation) {
    return;
  }

  Node.prototype.insertBefore = installation.insertBefore;
  Node.prototype.removeChild = installation.removeChild;
  delete nodePrototype[INSTALLATION_KEY];
}

function addTranslationMarker() {
  const marker = document.createElement("font");
  marker.dir = "auto";
  document.body.append(marker);
}

describe("browser translation DOM compatibility", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    restoreNativeDomMethods();
  });

  afterEach(() => {
    restoreNativeDomMethods();
  });

  it("preserves native errors when Google Translate has not changed the page", () => {
    installBrowserTranslationDomCompatibility();
    const parent = document.createElement("div");
    const detachedChild = document.createTextNode("Detached");

    expect(() => parent.removeChild(detachedChild)).toThrow(DOMException);
  });

  it("removes the Google Translate wrapper around a React-owned node", () => {
    addTranslationMarker();
    installBrowserTranslationDomCompatibility();
    const parent = document.createElement("div");
    const wrapper = document.createElement("font");
    const reactOwnedText = document.createTextNode("Original text");
    wrapper.append(reactOwnedText);
    parent.append(wrapper);

    expect(parent.removeChild(reactOwnedText)).toBe(reactOwnedText);
    expect(parent.childNodes).toHaveLength(0);
  });

  it("does not crash when Google Translate detached React's original text node", () => {
    addTranslationMarker();
    installBrowserTranslationDomCompatibility();
    const parent = document.createElement("div");
    const detachedReactText = document.createTextNode("Original text");
    parent.innerHTML = "<font>Texte traduit</font><span>Sibling</span>";

    expect(parent.removeChild(detachedReactText)).toBe(detachedReactText);
    expect(parent.textContent).toBe("Texte traduitSibling");
  });

  it("inserts before the translated wrapper when the reference is nested inside it", () => {
    addTranslationMarker();
    installBrowserTranslationDomCompatibility();
    const parent = document.createElement("div");
    const wrapper = document.createElement("font");
    const reactOwnedText = document.createTextNode("Original text");
    const newNode = document.createElement("span");
    wrapper.append(reactOwnedText);
    parent.append(wrapper);

    expect(parent.insertBefore(newNode, reactOwnedText)).toBe(newNode);
    expect(parent.firstChild).toBe(newNode);
    expect(parent.lastChild).toBe(wrapper);
  });
});
