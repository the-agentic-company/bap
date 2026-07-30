const INSTALLATION_KEY = Symbol.for("bap.browser-translation-dom-compatibility");

type NodePrototypeWithInstallation = Node & {
  [INSTALLATION_KEY]?: {
    insertBefore: typeof Node.prototype.insertBefore;
    removeChild: typeof Node.prototype.removeChild;
  };
};

function hasGoogleTranslateWrappers() {
  return (
    document.documentElement.classList.contains("translated-ltr") ||
    document.documentElement.classList.contains("translated-rtl") ||
    document.querySelector("font[dir='auto'], font[style*='vertical-align']") !== null
  );
}

function isRecoverableTranslationError(error: unknown) {
  return (
    error instanceof DOMException && error.name === "NotFoundError" && hasGoogleTranslateWrappers()
  );
}

function findDirectChild(parent: Node, node: Node) {
  let candidate: Node | null = node;

  while (candidate.parentNode && candidate.parentNode !== parent) {
    candidate = candidate.parentNode;
  }

  return candidate.parentNode === parent ? candidate : null;
}

/**
 * Google Translate replaces React-owned text nodes with nested <font> elements.
 * React can subsequently try to remove or insert relative to the original,
 * now-detached text node during a client-side route transition.
 *
 * Keep the native behavior for every ordinary DOM operation. If (and only if)
 * the native call fails while Google Translate wrappers are present, apply the
 * equivalent operation to the wrapper or use React's documented compatibility
 * fallback for a detached reference.
 */
export function installBrowserTranslationDomCompatibility() {
  if (typeof document === "undefined" || typeof Node === "undefined") {
    return;
  }

  const nodePrototype = Node.prototype as NodePrototypeWithInstallation;
  if (nodePrototype[INSTALLATION_KEY]) {
    return;
  }

  const nativeRemoveChild = Node.prototype.removeChild;
  const nativeInsertBefore = Node.prototype.insertBefore;

  Object.defineProperty(nodePrototype, INSTALLATION_KEY, {
    configurable: true,
    value: {
      insertBefore: nativeInsertBefore,
      removeChild: nativeRemoveChild,
    },
  });

  Node.prototype.removeChild = function removeChild<T extends Node>(child: T): T {
    try {
      return nativeRemoveChild.call(this, child) as T;
    } catch (error) {
      if (!isRecoverableTranslationError(error)) {
        throw error;
      }

      const translatedWrapper = findDirectChild(this, child);
      if (translatedWrapper) {
        nativeRemoveChild.call(this, translatedWrapper);
      } else if (this.childNodes.length === 1 && this.firstChild?.nodeName === "FONT") {
        nativeRemoveChild.call(this, this.firstChild);
      }

      return child;
    }
  };

  Node.prototype.insertBefore = function insertBefore<T extends Node>(
    newNode: T,
    referenceNode: Node | null,
  ): T {
    try {
      return nativeInsertBefore.call(this, newNode, referenceNode) as T;
    } catch (error) {
      if (!referenceNode || !isRecoverableTranslationError(error)) {
        throw error;
      }

      const translatedWrapper = findDirectChild(this, referenceNode);
      if (translatedWrapper) {
        return nativeInsertBefore.call(this, newNode, translatedWrapper) as T;
      }

      return this.appendChild(newNode) as T;
    }
  };
}
