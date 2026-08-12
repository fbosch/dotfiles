(function () {
  "use strict";

  const API = "/api/shared-todo";
  const ROOT_SELECTOR = "[data-shared-todo]";
  const initializedRoots = new WeakSet();
  const activeClients = new Map();

  const trashIconSvg = `<svg fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
    <path fill-rule="evenodd" d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5a.75.75 0 0 1 .786-.711Z" clip-rule="evenodd" />
  </svg>`;

  function itemAnim(height, entrance) {
    const visible = { height: `${height}px`, opacity: 1 };
    const hidden = { height: "0", opacity: 0, padding: "0" };
    return {
      keyframes: entrance === false ? [visible, hidden] : [hidden, visible],
      options: { duration: 200, easing: "ease" },
    };
  }

  function inputMarginAnim(entrance) {
    const amount = "1.5rem";
    return {
      keyframes: [
        { marginBottom: entrance === false ? amount : "0px" },
        { marginBottom: entrance === false ? "0" : amount },
      ],
      options: { duration: 200, easing: "ease", fill: "forwards" },
    };
  }

  function runAnimation(element, animation, callback) {
    element.animate(animation, callback);
  }

  function todoModuleUrl() {
    const pageScript = document.querySelector('script[type="module"][src*="/js/page.js"]');
    if (!pageScript) throw new Error("Unable to locate Glance's todo module");
    return pageScript.src.replace(/page\.js(?:\?.*)?$/, "todo.js");
  }

  function createClient(root, todoModule) {
    const { autoScalingTextarea, verticallyReorderable } = todoModule;
    let state = {
      revision: Number(root.dataset.revision || 0),
      tasks: Array.from(root.querySelectorAll("[data-task-id]")).map(function (item) {
        return {
          id: item.dataset.taskId,
          text: item.querySelector(".todo-item-text")?.value || "",
          checked: item.dataset.taskChecked === "true",
        };
      }),
    };
    let eventSource;
    let inputArea;
    let inputContainer;
    let items;
    let lastAddedItem;
    let queuedForRemoval = 0;
    let reorderable;
    let isDragging = false;
    let isSaving = false;
    let savePending = false;
    let refreshPending = false;
    let saveTimeout;
    let saveDebounces = 0;

    function errorMessage(error) {
      if (error.status === 404) {
        return "Shared task service route is not configured (HTTP 404)";
      }
      return error.message;
    }

    function showError(error) {
      let message = root.querySelector("[data-shared-todo-error]");
      if (!message) {
        message = document.createElement("p");
        message.className = "shared-todo-error color-negative size-h5";
        message.dataset.sharedTodoError = "";
        root.prepend(message);
      }
      message.textContent = errorMessage(error);
    }

    function clearError() {
      root.querySelector("[data-shared-todo-error]")?.remove();
    }

    async function request(path, options) {
      const response = await fetch(`${API}${path}`, {
        ...options,
        keepalive: options?.body !== undefined,
        headers: options?.body ? { "Content-Type": "application/json" } : undefined,
      });
      const payload = await response.json().catch(function () {
        return null;
      });
      if (!response.ok) {
        const error = new Error(
          payload?.error?.message || `Task request failed (HTTP ${response.status})`,
        );
        error.status = response.status;
        throw error;
      }
      return payload;
    }

    function serializedItems() {
      return Array.from(items.children).map(function (item) {
        return item.component.serialize();
      });
    }

    async function saveItems() {
      if (isDragging || !items) return;
      if (isSaving) {
        savePending = true;
        return;
      }
      isSaving = true;
      try {
        state = await request("/tasks", {
          method: "PUT",
          body: JSON.stringify({
            revision: state.revision,
            tasks: serializedItems(),
          }),
        });
        clearError();
      } catch (error) {
        showError(error);
        if (error.status === 409) await refresh();
      } finally {
        isSaving = false;
        if (savePending) {
          savePending = false;
          saveItems();
        } else if (refreshPending) {
          refresh();
        }
      }
    }

    function debouncedSave() {
      clearTimeout(saveTimeout);
      saveDebounces += 1;
      if (saveDebounces === 10) {
        saveDebounces = 0;
        saveItems();
        return;
      }
      saveTimeout = setTimeout(function () {
        saveDebounces = 0;
        saveItems();
      }, 1000);
    }

    function immediateSave() {
      clearTimeout(saveTimeout);
      saveDebounces = 0;
      saveItems();
    }

    function Item(data) {
      let item;
      let input;
      let textarea;
      const serializable = {
        id: data.id || crypto.randomUUID(),
        text: data.text || "",
        checked: data.checked || false,
      };

      const checkbox = document.createElement("input");
      checkbox.className = "todo-item-checkbox shrink-0";
      checkbox.style.marginTop = "-0.1rem";
      checkbox.type = "checkbox";
      checkbox.checked = serializable.checked;
      checkbox.addEventListener("change", function (event) {
        serializable.checked = event.target.checked;
        immediateSave();
      });

      input = autoScalingTextarea(function (area) {
        textarea = area;
        area.classList.add("todo-item-text");
        area.placeholder = "empty task";
        area.spellcheck = false;
        area.addEventListener("keydown", function (event) {
          if (event.key === "Enter") event.preventDefault();
          if (event.key === "Escape") {
            event.preventDefault();
            inputArea.focus();
          }
        });
        area.addEventListener("input", function () {
          serializable.text = area.value;
          debouncedSave();
        });
      });
      input.classList.add("min-width-0", "grow");

      const dragHandle = document.createElement("div");
      dragHandle.className = "todo-item-drag-handle";
      dragHandle.addEventListener("mousedown", function (event) {
        isDragging = true;
        reorderable.component.onDragStart(event, item);
      });
      input.append(dragHandle);

      const remove = document.createElement("button");
      remove.className = "todo-item-delete shrink-0";
      remove.innerHTML = trashIconSvg;
      remove.addEventListener("click", function () {
        if (lastAddedItem === item) lastAddedItem = null;
        const height = item.clientHeight;
        queuedForRemoval += 1;
        runAnimation(item, itemAnim(height, false), function () {
          item.remove();
          queuedForRemoval -= 1;
          saveItems();
        });
        if (items.children.length - queuedForRemoval === 0) {
          runAnimation(inputContainer, inputMarginAnim(false));
        }
      });

      item = document.createElement("div");
      item.className = "todo-item flex gap-10 items-center";
      item.append(checkbox, input, remove);
      input.component.setValue(serializable.text);
      item.component = {
        focusInput: function () {
          textarea.focus();
        },
        serialize: function () {
          return serializable;
        },
      };
      return item;
    }

    function addNewItem(text, prepend) {
      const countBefore = items.children.length;
      const item = Item({ id: crypto.randomUUID(), text, checked: false });
      lastAddedItem = item;
      prepend ? items.prepend(item) : items.append(item);
      saveItems();
      runAnimation(item, itemAnim(item.clientHeight));
      if (countBefore === 0) runAnimation(inputContainer, inputMarginAnim());
    }

    function render() {
      root.replaceChildren();
      items = document.createElement("div");
      items.className = "todo-items";
      state.tasks.forEach(function (task) {
        items.append(Item(task));
      });

      inputContainer = document.createElement("div");
      inputContainer.className = "todo-input flex gap-10 items-center";
      if (items.children.length > 0) inputContainer.classList.add("margin-bottom-15");
      inputContainer.style.paddingRight = "2.5rem";

      const plus = document.createElement("div");
      plus.className = "todo-plus-icon shrink-0";
      const input = autoScalingTextarea(function (area) {
        inputArea = area;
        area.placeholder = "Add a task";
        area.spellcheck = false;
        area.addEventListener("keydown", function (event) {
          if (event.key === "Enter") {
            event.preventDefault();
            const value = event.target.value.trim();
            if (!value) return;
            addNewItem(value, event.ctrlKey);
            input.component.setValue("");
          } else if (event.key === "Escape") {
            event.target.blur();
          } else if (event.key === "ArrowDown" && lastAddedItem) {
            event.preventDefault();
            lastAddedItem.component.focusInput();
          }
        });
      });
      input.classList.add("grow", "min-width-0");
      inputContainer.append(plus, input);

      reorderable = verticallyReorderable(
        items,
        saveItems,
        function () {
          isDragging = false;
          if (refreshPending) refresh();
        },
      );
      root.append(inputContainer, reorderable);
    }

    function canRefresh() {
      const active = document.activeElement;
      return !isDragging && !isSaving && (!active || !root.contains(active));
    }

    async function refresh() {
      if (!root.isConnected) return;
      if (!canRefresh()) {
        refreshPending = true;
        return;
      }
      try {
        const nextState = await request("/tasks");
        if (nextState.revision < state.revision) return;
        state = nextState;
        refreshPending = false;
        clearError();
        render();
      } catch (error) {
        root.replaceChildren();
        showError(error);
      }
    }

    render();
    window.addEventListener("pagehide", immediateSave);
    eventSource = new EventSource(`${API}/events`);
    eventSource.addEventListener("revision", function (event) {
      const revision = Number(event.data);
      if (Number.isSafeInteger(revision) && revision !== state.revision) refresh();
    });

    return {
      close: function () {
        clearTimeout(saveTimeout);
        window.removeEventListener("pagehide", immediateSave);
        eventSource.close();
      },
    };
  }

  let todoModulePromise;
  function initializeRoots() {
    const roots = document.querySelectorAll(ROOT_SELECTOR);
    if (roots.length > 0 && !todoModulePromise) {
      todoModulePromise = import(todoModuleUrl());
    }
    roots.forEach(function (root) {
      if (initializedRoots.has(root)) return;
      initializedRoots.add(root);
      todoModulePromise
        .then(function (todoModule) {
          if (root.isConnected) activeClients.set(root, createClient(root, todoModule));
        })
        .catch(function (error) {
          root.textContent = error.message;
          root.classList.add("color-negative", "size-h5");
        });
    });

    for (const [root, client] of activeClients) {
      if (root.isConnected) continue;
      client.close();
      activeClients.delete(root);
    }
  }

  initializeRoots();
  const observer = new MutationObserver(initializeRoots);
  observer.observe(document.getElementById("page-content") || document.body, {
    childList: true,
    subtree: true,
  });
})();
