(() => {
  const SELECTORS = {
    root: ".chatbot",
    chat: ".chatbot__chat",
    wrap: ".chatbot__wrap",
    shell: ".chatbot__shell",
    content: ".chatbot__content",
    form: ".chatbot__form",
    input: ".field-chatbot__field",
    submit: ".chatbot__submit",
    openBtn: ".chatbot__btn",
    closeBtn: ".chatbot__close-btn",
  };

  const ROLE = Object.freeze({
    BOT: "bot",
    USER: "user",
  });

  const STATUS = Object.freeze({
    IDLE: "idle",
    PENDING: "pending",
    LOCKED: "locked",
    ERROR: "error",
  });

  const DEFAULTS = Object.freeze({
    initialOpen: false,
    autoPendingOnSend: true,
    lockInputOnPending: false,
    allowParallelRequests: false,
    optionGroupsSingleUse: true,
    scrollBehavior: "smooth",
    errorText: "Что-то пошло не так. Попробуйте ещё раз.",
    onSubmit: null,
    pendingDelay: 180,
    simplebar: true,
    simplebarAutoHide: false,
    simplebarForceVisible: "y",
    stickToBottomThreshold: 48,
    autoHide: false,
  });

  const clone = value => {
    if (typeof structuredClone === "function") {
      return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  };

  const uid = (prefix = "cb") =>
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  class ChatbotWidget {
    constructor(root, options = {}) {
      if (!root) {
        throw new Error("Chatbot root element not found");
      }

      this.root = root;
      this.options = { ...DEFAULTS, ...options };
      this.dom = this.cacheDom();
      this.initialShellHTML = this.dom.shell.innerHTML;

      this.state = {
        status: STATUS.IDLE,
        isOpen: Boolean(this.options.initialOpen),
        isLocked: false,
        pendingId: null,
        activeRequestId: null,
        requestSeq: 0,
      };

      this.pendingTimer = null;
      this.simplebar = null;
      this.scrollEl = null;
      this.resizeObserver = null;
      this.mutationObserver = null;
      this.userScrolledUp = false;
      this.scrollRaf = null;

      this.bound = {
        onFormSubmit: this.onFormSubmit.bind(this),
        onOpenClick: this.toggle.bind(this),
        onCloseClick: this.close.bind(this),
        onOptionChange: this.onOptionChange.bind(this),
        onDocumentClick: this.onDocumentClick.bind(this),
        onScroll: this.onScroll.bind(this),
        onWindowResize: this.onWindowResize.bind(this),
      };

      this.initSimplebar();
      this.bind();
      this.initObservers();
      this.renderState();
      this.scrollToBottom({ behavior: "auto", force: true });
    }

    cacheDom() {
      const dom = {
        root: this.root,
        chat: this.root.querySelector(SELECTORS.chat),
        wrap: this.root.querySelector(SELECTORS.wrap),
        shell: this.root.querySelector(SELECTORS.shell),
        content: this.root.querySelector(SELECTORS.content),
        form: this.root.querySelector(SELECTORS.form),
        input: this.root.querySelector(SELECTORS.input),
        submit: this.root.querySelector(SELECTORS.submit),
        openBtn: this.root.querySelector(SELECTORS.openBtn),
        closeBtn: this.root.querySelector(SELECTORS.closeBtn),
      };

      const required = [
        "chat",
        "wrap",
        "shell",
        "content",
        "form",
        "input",
        "submit",
      ];

      required.forEach(key => {
        if (!dom[key]) {
          throw new Error(`Chatbot: required element "${key}" not found`);
        }
      });

      return dom;
    }

    initSimplebar() {
      const shouldUseSimplebar =
        this.options.simplebar &&
        typeof window.SimpleBar !== "undefined" &&
        this.dom.content;

      if (!shouldUseSimplebar) {
        this.scrollEl = this.dom.content;
        return;
      }

      if (!this.dom.content.hasAttribute("data-simplebar")) {
        this.dom.content.setAttribute("data-simplebar", "");
      }

      this.simplebar = new window.SimpleBar(this.dom.content, {
        autoHide: this.options.simplebarAutoHide,
        forceVisible: this.options.simplebarForceVisible,
      });

      this.scrollEl = this.simplebar.getScrollElement();
    }

    getScrollElement() {
      return this.scrollEl || this.dom.content;
    }

    recalculateSimplebar() {
      if (this.simplebar && typeof this.simplebar.recalculate === "function") {
        this.simplebar.recalculate();
      }
    }

    bind() {
      this.dom.form.addEventListener("submit", this.bound.onFormSubmit);
      this.dom.shell.addEventListener("change", this.bound.onOptionChange);

      if (this.dom.openBtn) {
        this.dom.openBtn.addEventListener("click", this.bound.onOpenClick);
      }

      if (this.dom.closeBtn) {
        this.dom.closeBtn.addEventListener("click", this.bound.onCloseClick);
      }

      document.addEventListener("click", this.bound.onDocumentClick);

      if (this.getScrollElement()) {
        this.getScrollElement().addEventListener(
          "scroll",
          this.bound.onScroll,
          {
            passive: true,
          },
        );
      }

      window.addEventListener("resize", this.bound.onWindowResize, {
        passive: true,
      });
    }

    unbind() {
      this.dom.form.removeEventListener("submit", this.bound.onFormSubmit);
      this.dom.shell.removeEventListener("change", this.bound.onOptionChange);

      if (this.dom.openBtn) {
        this.dom.openBtn.removeEventListener("click", this.bound.onOpenClick);
      }

      if (this.dom.closeBtn) {
        this.dom.closeBtn.removeEventListener("click", this.bound.onCloseClick);
      }

      document.removeEventListener("click", this.bound.onDocumentClick);

      if (this.getScrollElement()) {
        this.getScrollElement().removeEventListener(
          "scroll",
          this.bound.onScroll,
        );
      }

      window.removeEventListener("resize", this.bound.onWindowResize);
    }

    initObservers() {
      if (typeof MutationObserver !== "undefined") {
        this.mutationObserver = new MutationObserver(() => {
          this.recalculateSimplebar();

          if (!this.userScrolledUp) {
            this.scrollToBottom({ behavior: "auto", force: true });
          }
        });

        this.mutationObserver.observe(this.dom.shell, {
          childList: true,
          subtree: true,
        });
      }

      if (typeof ResizeObserver !== "undefined") {
        this.resizeObserver = new ResizeObserver(() => {
          this.recalculateSimplebar();

          if (!this.userScrolledUp) {
            this.scrollToBottom({ behavior: "auto", force: true });
          }
        });

        this.resizeObserver.observe(this.dom.shell);
      }
    }

    disconnectObservers() {
      if (this.mutationObserver) {
        this.mutationObserver.disconnect();
        this.mutationObserver = null;
      }

      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
        this.resizeObserver = null;
      }
    }

    destroy() {
      this.clearPendingTimer();
      this.disconnectObservers();
      this.unbind();

      if (this.scrollRaf) {
        cancelAnimationFrame(this.scrollRaf);
        this.scrollRaf = null;
      }

      if (this.simplebar && typeof this.simplebar.unMount === "function") {
        this.simplebar.unMount();
      }

      this.root.removeAttribute("data-status");
      this.root.removeAttribute("data-open");
      this.root.classList.remove("is-open", "is-pending", "is-locked");

      if (window.FLCChatbot === this) {
        delete window.FLCChatbot;
      }
    }

    on(type, handler) {
      const eventName = `chatbot:${type}`;
      this.root.addEventListener(eventName, handler);

      return () => {
        this.root.removeEventListener(eventName, handler);
      };
    }

    emit(type, detail = {}) {
      this.root.dispatchEvent(
        new CustomEvent(`chatbot:${type}`, {
          detail,
        }),
      );
    }

    getState() {
      return clone(this.state);
    }

    clearPendingTimer() {
      if (this.pendingTimer) {
        clearTimeout(this.pendingTimer);
        this.pendingTimer = null;
      }
      return this;
    }

    onWindowResize() {
      this.recalculateSimplebar();

      if (!this.userScrolledUp) {
        this.scrollToBottom({ behavior: "auto", force: true });
      }
    }

    onScroll() {
      this.userScrolledUp = !this.isNearBottom();
    }

    isNearBottom(threshold = this.options.stickToBottomThreshold) {
      const el = this.getScrollElement();
      if (!el) return true;

      const distance = el.scrollHeight - el.clientHeight - el.scrollTop;
      return distance <= threshold;
    }

    renderState() {
      const isPending = this.state.status === STATUS.PENDING;
      const isLockedByState = this.state.isLocked;
      const isLockedByPending = this.options.lockInputOnPending && isPending;
      const hasUnselectedOptions = this.hasUnselectedOptions();

      const controlsDisabled =
        isLockedByState || isLockedByPending || hasUnselectedOptions;

      const formIsDisabled = controlsDisabled || isPending;

      this.root.dataset.status = this.state.status;
      this.root.dataset.open = String(this.state.isOpen);

      this.root.classList.toggle("is-open", this.state.isOpen);
      this.root.classList.toggle("is-pending", isPending);
      this.root.classList.toggle("is-locked", controlsDisabled);

      this.dom.form.classList.toggle("_is-disabled", formIsDisabled);

      this.dom.input.disabled = controlsDisabled;
      this.dom.submit.disabled = controlsDisabled;
      this.dom.content.setAttribute("aria-busy", String(isPending));

      this.recalculateSimplebar();
    }

    setStatus(status, patch = {}) {
      const prev = this.getState();

      this.state = {
        ...this.state,
        ...patch,
        status,
      };

      this.renderState();

      this.emit("statechange", {
        prev,
        next: this.getState(),
      });

      return this;
    }

    lock() {
      this.state.isLocked = true;
      this.renderState();
      return this;
    }

    unlock() {
      this.state.isLocked = false;
      this.renderState();
      return this;
    }

    open({ silent = false } = {}) {
      this.state.isOpen = true;
      this.renderState();

      requestAnimationFrame(() => {
        this.recalculateSimplebar();
        this.scrollToBottom({ behavior: "auto", force: true });
      });

      if (!silent) {
        this.emit("open", { state: this.getState() });
      }

      return this;
    }

    close({ silent = false } = {}) {
      this.state.isOpen = false;
      this.renderState();

      if (!silent) {
        this.emit("close", { state: this.getState() });
      }

      return this;
    }

    toggle() {
      return this.state.isOpen ? this.close() : this.open();
    }

    onDocumentClick(event) {
      if (!this.state.isOpen) return;

      const target = event.target;
      if (!(target instanceof Node)) return;

      if (this.dom.wrap.contains(target)) return;
      if (this.dom.openBtn && this.dom.openBtn.contains(target)) return;
      if (target.closest("[data-chatbot-devpanel]")) return;

      this.close();
    }

    onFormSubmit(event) {
      event.preventDefault();

      const value = this.dom.input.value.trim();
      if (!value) return;

      const requestId = this.send(value, { source: "input" });

      if (requestId) {
        this.dom.input.value = "";
      }
    }

    onOptionChange(event) {
      const input = event.target.closest(".option-chatbot__input");
      if (!input) return;

      const group = input.closest(".chatbot__options");
      if (!group) return;

      if (group.dataset.locked === "true") {
        input.checked = false;
        return;
      }

      const optionEl = input.closest(".option-chatbot");
      const label =
        optionEl?.dataset.label ||
        optionEl?.querySelector(".option-chatbot__txt")?.textContent?.trim() ||
        input.value;

      const value = optionEl?.dataset.value || input.value || label;

      const meta = {
        source: "option",
        optionLabel: label,
        optionValue: value,
        optionGroupId: group.dataset.optionGroupId || null,
        optionId: optionEl?.dataset.optionId || null,
      };

      const requestId = this.send(label, meta);

      if (!requestId) {
        input.checked = false;
        return;
      }

      const shouldLockGroup =
        group.dataset.singleUse === "true" ||
        this.options.optionGroupsSingleUse;

      if (shouldLockGroup) {
        this.disableOptionGroup(group);
      }

      this.emit("optionselect", {
        ...meta,
        requestId,
      });
    }

    send(text, meta = {}) {
      const value = String(text ?? "")
        .replace(/\s+/g, " ")
        .trim();

      if (!value) return null;

      const isBusy =
        this.state.isLocked || this.state.status === STATUS.PENDING;

      if (isBusy && !this.options.allowParallelRequests) {
        return null;
      }

      const requestId = `req-${++this.state.requestSeq}`;
      const shouldStick = this.isNearBottom();

      this.addUserMessage(value, meta, { scroll: false });

      this.state.activeRequestId = requestId;

      if (this.options.autoPendingOnSend) {
        this.setStatus(STATUS.PENDING, {
          activeRequestId: requestId,
        });

        this.clearPendingTimer();

        const delay = Math.max(0, Number(this.options.pendingDelay) || 0);

        if (delay > 0) {
          this.pendingTimer = setTimeout(() => {
            this.pendingTimer = null;

            if (this.state.activeRequestId !== requestId) return;
            if (this.state.status !== STATUS.PENDING) return;
            if (this.state.pendingId) return;

            this.showPending(
              { requestId },
              { scroll: false },
              { setPendingStatus: false, requestId },
            );

            if (shouldStick) {
              this.userScrolledUp = false;
              this.scrollToBottom({ behavior: "auto", force: true });
            }
          }, delay);
        } else {
          this.showPending(
            { requestId },
            { scroll: false },
            { setPendingStatus: false, requestId },
          );
        }
      } else {
        this.setStatus(STATUS.PENDING, {
          activeRequestId: requestId,
        });
      }

      if (shouldStick) {
        this.userScrolledUp = false;
        this.scrollToBottom({ behavior: "auto", force: true });
      }

      const payload = {
        requestId,
        text: value,
        meta,
        state: this.getState(),
      };

      this.emit("outgoing", payload);

      if (typeof this.options.onSubmit === "function") {
        Promise.resolve(this.options.onSubmit(payload, this))
          .then(response => {
            if (response !== undefined) {
              this.resolve(requestId, response);
            }
          })
          .catch(error => {
            this.reject(requestId, error);
          });
      }

      return requestId;
    }

    resolve(requestId, response = {}) {
      this.clearPendingTimer();

      if (
        !this.options.allowParallelRequests &&
        this.state.activeRequestId &&
        requestId !== this.state.activeRequestId
      ) {
        return false;
      }

      const shouldStick = this.isNearBottom();

      if (response.removePending !== false) {
        this.hidePending();
      }

      let hasNewContent = false;

      if (Array.isArray(response.messages) && response.messages.length) {
        this.addMessages(response.messages, { scroll: false });
        hasNewContent = true;
      }

      if (Array.isArray(response.blocks) && response.blocks.length) {
        this.addMessage(
          {
            role: ROLE.BOT,
            blocks: response.blocks,
          },
          { scroll: false },
        );
        hasNewContent = true;
      }

      if (typeof response.text === "string" && response.text.trim()) {
        this.addBotMessage(response.text, {}, { scroll: false });
        hasNewContent = true;
      }

      if (Array.isArray(response.options) && response.options.length) {
        const blocks = [];

        if (response.optionsText) {
          blocks.push({
            type: "text",
            text: response.optionsText,
          });
        }

        blocks.push({
          type: "options",
          options: response.options,
          name: response.optionGroupName,
          singleUse:
            response.optionSingleUse !== undefined ?
              response.optionSingleUse
            : true,
        });

        this.addMessage(
          {
            role: ROLE.BOT,
            blocks,
          },
          { scroll: false },
        );
        hasNewContent = true;
      }

      if (hasNewContent && shouldStick) {
        this.userScrolledUp = false;
        this.scrollToBottom({ behavior: "auto", force: true });
      }

      this.setStatus(response.status || STATUS.IDLE, {
        activeRequestId: null,
      });

      this.emit("resolved", {
        requestId,
        response,
        state: this.getState(),
      });

      return true;
    }

    reject(requestId, error) {
      this.clearPendingTimer();

      if (
        !this.options.allowParallelRequests &&
        this.state.activeRequestId &&
        requestId !== this.state.activeRequestId
      ) {
        return false;
      }

      const shouldStick = this.isNearBottom();

      this.hidePending();

      let errorText = this.options.errorText;

      if (typeof error === "string" && error.trim()) {
        errorText = error;
      } else if (
        error &&
        typeof error.message === "string" &&
        error.message.trim()
      ) {
        errorText = error.message;
      }

      if (errorText) {
        this.addBotMessage(errorText, { isError: true }, { scroll: false });

        if (shouldStick) {
          this.userScrolledUp = false;
          this.scrollToBottom({ behavior: "auto", force: true });
        }
      }

      this.setStatus(STATUS.ERROR, {
        activeRequestId: null,
      });

      this.emit("rejected", {
        requestId,
        error,
        state: this.getState(),
      });

      return true;
    }

    showPending(
      meta = {},
      options = {},
      { setPendingStatus = true, requestId = null } = {},
    ) {
      this.hidePending();

      const pendingId = uid("pending");
      const nextRequestId = requestId || this.state.activeRequestId || null;

      this.state.pendingId = pendingId;

      this.addMessage(
        {
          id: pendingId,
          role: ROLE.BOT,
          blocks: [{ type: "loader" }],
          meta: {
            ...meta,
            isPending: true,
          },
        },
        options,
      );

      if (setPendingStatus) {
        this.setStatus(STATUS.PENDING, {
          activeRequestId: nextRequestId,
        });
      }

      return pendingId;
    }

    hidePending(
      messageId = this.state.pendingId,
      { resetStatus = false } = {},
    ) {
      if (!messageId) return false;

      const node = this.findMessageWrap(messageId);
      if (node) {
        node.remove();
      }

      if (this.state.pendingId === messageId) {
        this.state.pendingId = null;
      }

      this.recalculateSimplebar();

      if (resetStatus && this.state.status === STATUS.PENDING) {
        this.setStatus(STATUS.IDLE, {
          activeRequestId: null,
        });
      }

      return Boolean(node);
    }

    findMessageWrap(messageId) {
      return (
        [...this.dom.shell.querySelectorAll(".chatbot__messages-wrap")].find(
          node => node.dataset.messageId === messageId,
        ) || null
      );
    }

    removeMessage(messageId) {
      const node = this.findMessageWrap(messageId);
      if (!node) return false;

      node.remove();

      if (this.state.pendingId === messageId) {
        this.state.pendingId = null;
      }

      this.recalculateSimplebar();
      return true;
    }

    addMessages(messages = [], { scroll = true } = {}) {
      messages.forEach(message => this.addMessage(message, { scroll: false }));

      if (scroll && messages.length) {
        this.scrollToBottom({ behavior: "auto", force: true });
      }

      return this;
    }

    addUserMessage(text, meta = {}, options = {}) {
      return this.addMessage(
        {
          role: ROLE.USER,
          blocks: [{ type: "text", text }],
          meta,
        },
        options,
      );
    }

    addBotMessage(text, meta = {}, options = {}) {
      return this.addMessage(
        {
          role: ROLE.BOT,
          blocks: [{ type: "text", text }],
          meta,
        },
        options,
      );
    }

    addMessage(message, { scroll = true } = {}) {
      const normalized = this.normalizeMessage(message);
      const lastWrap = this.getLastWrap();

      if (this.canAppendToWrap(lastWrap, normalized)) {
        this.appendBlocksToWrap(lastWrap, normalized);
        this.renderState();

        this.emit("messageadded", {
          message: normalized,
          element: lastWrap,
        });

        if (scroll) {
          this.scrollToBottom({ behavior: "auto", force: true });
        }

        return normalized.id;
      }

      const wrap = this.buildWrap(normalized);

      this.dom.shell.append(wrap);
      this.renderState();

      requestAnimationFrame(() => {
        wrap.classList.add("is-entering");
      });

      wrap.addEventListener(
        "animationend",
        () => {
          wrap.classList.remove("is-entering");
        },
        { once: true },
      );

      this.emit("messageadded", {
        message: normalized,
        element: wrap,
      });

      if (scroll) {
        this.scrollToBottom({ behavior: "auto", force: true });
      }

      return normalized.id;
    }

    normalizeMessage(message) {
      const source =
        typeof message === "string" ?
          {
            role: ROLE.BOT,
            blocks: [{ type: "text", text: message }],
          }
        : message;

      const role = source.role === ROLE.USER ? ROLE.USER : ROLE.BOT;

      const blocks =
        Array.isArray(source.blocks) && source.blocks.length ?
          source.blocks.map(block => this.normalizeBlock(block))
        : [{ type: "text", text: String(source.text ?? "") }];

      return {
        id: source.id || uid("msg"),
        role,
        blocks,
        meta: source.meta ? clone(source.meta) : {},
      };
    }

    normalizeBlock(block) {
      if (!block || typeof block !== "object") {
        return { type: "text", text: "" };
      }

      switch (block.type) {
        case "list":
          return {
            type: "list",
            text: block.text ? String(block.text) : "",
            items: Array.isArray(block.items) ? block.items.map(String) : [],
          };

        case "options":
          return {
            type: "options",
            name: block.name || uid("options"),
            singleUse: block.singleUse !== false,
            options: (Array.isArray(block.options) ? block.options : []).map(
              (item, index) => {
                if (typeof item === "string") {
                  return {
                    id: `opt-${index}`,
                    label: item,
                    value: item,
                    checked: false,
                    disabled: false,
                  };
                }

                return {
                  id: item.id || `opt-${index}`,
                  label: String(item.label ?? item.value ?? ""),
                  value: String(item.value ?? item.label ?? ""),
                  checked: Boolean(item.checked),
                  disabled: Boolean(item.disabled),
                };
              },
            ),
          };

        case "loader":
          return { type: "loader" };

        case "text":
        default:
          return {
            type: "text",
            text: String(block.text ?? ""),
          };
      }
    }

    buildWrap(message) {
      const wrap = document.createElement("div");
      wrap.className = "chatbot__messages-wrap";
      wrap.dataset.messageId = message.id;
      wrap.dataset.role = message.role;

      if (message.meta?.isPending) {
        wrap.dataset.pending = "true";
      }

      if (message.role === ROLE.BOT) {
        wrap.append(this.createBotIcon());
      }

      const messages = document.createElement("div");
      messages.className = "chatbot__messages";
      wrap.append(messages);

      message.blocks.forEach(block => {
        const node = this.buildBlock(block);
        if (!node) return;
        messages.append(node);
      });

      return wrap;
    }

    buildBlock(block) {
      switch (block.type) {
        case "list":
          return this.createListBubble(block);
        case "options":
          return this.createOptions(block);
        case "loader":
          return this.createLoaderBubble();
        case "text":
        default:
          return this.createTextBubble(block.text);
      }
    }

    createBotIcon() {
      const icon = document.createElement("div");
      icon.className = "chatbot__bot ic";
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = `
        <svg>
          <use href="#sparkle-svg"></use>
        </svg>
      `;
      return icon;
    }

    createTextBubble(text) {
      const message = document.createElement("div");
      message.className = "chatbot__message";

      const p = document.createElement("p");
      p.className = "chatbot__txt txt";
      p.textContent = text;

      message.append(p);
      return message;
    }

    createListBubble({ text, items }) {
      const message = document.createElement("div");
      message.className = "chatbot__message";

      if (text) {
        const p = document.createElement("p");
        p.className = "chatbot__txt txt";
        p.textContent = text;
        message.append(p);
      }

      if (items.length) {
        const list = document.createElement("ul");
        list.className = "chatbot__list";

        items.forEach(item => {
          const li = document.createElement("li");
          li.className = "chatbot__list-item txt-s";
          li.textContent = item;
          list.append(li);
        });

        message.append(list);
      }

      return message;
    }

    createLoaderBubble() {
      const message = document.createElement("div");
      message.className = "chatbot__message";

      const loader = document.createElement("div");
      loader.className = "loader-dots";
      loader.setAttribute("aria-hidden", "true");

      for (let i = 0; i < 3; i += 1) {
        const dot = document.createElement("div");
        dot.className = "dot";
        loader.append(dot);
      }

      message.append(loader);
      return message;
    }

    createOptions({ options, name, singleUse }) {
      const list = document.createElement("ul");
      list.className = "chatbot__options";
      list.dataset.optionGroupId = uid("optgroup");
      list.dataset.singleUse = String(singleUse !== false);

      options.forEach(option => {
        const li = document.createElement("li");
        li.className = "chatbot__option option-chatbot";
        li.dataset.optionId = option.id;
        li.dataset.label = option.label;
        li.dataset.value = option.value;

        const input = document.createElement("input");
        input.type = "radio";
        input.name = name;
        input.value = option.value;
        input.className = "option-chatbot__input";

        if (option.checked) {
          input.checked = true;
        }

        if (option.disabled) {
          input.disabled = true;
        }

        const span = document.createElement("span");
        span.className = "option-chatbot__txt txt-s";
        span.textContent = option.label;

        li.append(input, span);
        list.append(li);
      });

      return list;
    }

    isOptionsOnlyMessage(message) {
      return (
        Array.isArray(message.blocks) &&
        message.blocks.length > 0 &&
        message.blocks.every(block => block.type === "options")
      );
    }

    isPlainMessagesOnly(message) {
      return (
        Array.isArray(message.blocks) &&
        message.blocks.length > 0 &&
        message.blocks.every(block => this.isPlainMessageBlock(block))
      );
    }

    hasLoaderBlock(message) {
      return (
        Array.isArray(message.blocks) &&
        message.blocks.some(block => block.type === "loader")
      );
    }

    getMessagesContainer(wrap) {
      return (
        [...wrap.children].find(
          node =>
            node instanceof HTMLElement &&
            node.classList.contains("chatbot__messages"),
        ) || null
      );
    }

    canAppendToWrap(wrap, message) {
      if (!wrap) return false;
      if (wrap.dataset.role !== message.role) return false;
      if (wrap.dataset.pending === "true") return false;
      if (message.meta?.isPending) return false;
      if (this.hasLoaderBlock(message)) return false;
      if (this.wrapHasOptions(wrap)) return false;

      if (this.isPlainMessagesOnly(message)) {
        return Boolean(this.getMessagesContainer(wrap));
      }

      if (this.isOptionsOnlyMessage(message) && message.role === ROLE.BOT) {
        return Boolean(this.getMessagesContainer(wrap));
      }

      return false;
    }

    appendBlocksToWrap(wrap, message) {
      const messages = this.getMessagesContainer(wrap);
      if (!messages) return;

      message.blocks.forEach(block => {
        const node = this.buildBlock(block);
        if (!node) return;
        messages.append(node);
      });
    }

    hasUnselectedOptions() {
      return [...this.dom.shell.querySelectorAll(".chatbot__options")].some(
        group => {
          if (group.dataset.locked === "true") return false;

          const inputs = [
            ...group.querySelectorAll(".option-chatbot__input:not(:disabled)"),
          ];

          if (!inputs.length) return false;

          return !inputs.some(input => input.checked);
        },
      );
    }

    wrapHasOptions(wrap) {
      return Boolean(wrap.querySelector(".chatbot__options"));
    }

    getLastWrap() {
      const wraps = this.dom.shell.querySelectorAll(".chatbot__messages-wrap");
      return wraps.length ? wraps[wraps.length - 1] : null;
    }

    isPlainMessageBlock(block) {
      return block.type === "text" || block.type === "list";
    }

    disableOptionGroup(group) {
      if (!group) return;

      group.dataset.locked = "true";

      group.querySelectorAll(".option-chatbot__input").forEach(input => {
        input.disabled = true;
      });
    }

    setTransport(fn) {
      this.options.onSubmit = typeof fn === "function" ? fn : null;
      return this;
    }

    clear() {
      this.dom.shell.innerHTML = "";
      this.state.pendingId = null;
      this.userScrolledUp = false;

      this.setStatus(STATUS.IDLE, {
        activeRequestId: null,
        pendingId: null,
      });

      this.recalculateSimplebar();
      this.scrollToBottom({ behavior: "auto", force: true });

      return this;
    }

    reset({ restoreInitial = true } = {}) {
      this.dom.shell.innerHTML = restoreInitial ? this.initialShellHTML : "";
      this.state.pendingId = null;
      this.userScrolledUp = false;

      this.setStatus(STATUS.IDLE, {
        activeRequestId: null,
        pendingId: null,
      });

      this.recalculateSimplebar();
      this.scrollToBottom({ behavior: "auto", force: true });

      return this;
    }

    scrollToBottom({
      behavior = this.options.scrollBehavior,
      force = false,
    } = {}) {
      const el = this.getScrollElement();
      if (!el) return;

      if (!force && this.userScrolledUp) return;

      this.recalculateSimplebar();

      if (this.scrollRaf) {
        cancelAnimationFrame(this.scrollRaf);
      }

      this.scrollRaf = requestAnimationFrame(() => {
        const maxTop = el.scrollHeight - el.clientHeight;
        if (maxTop <= 0) return;

        if (behavior === "auto") {
          el.scrollTop = maxTop;
        } else {
          el.scrollTo({
            top: maxTop,
            behavior,
          });
        }
      });
    }
  }

  const initChatbot = () => {
    const root = document.querySelector(SELECTORS.root);
    if (!root || window.FLCChatbot) return;

    const chatbot = new ChatbotWidget(root, {
      initialOpen: false,
      autoPendingOnSend: true,
      lockInputOnPending: false,
      allowParallelRequests: false,
      simplebar: true,
      simplebarAutoHide: false,
      simplebarForceVisible: "y",
      stickToBottomThreshold: 48,
    });

    window.FLCChatbot = chatbot;

    window.dispatchEvent(
      new CustomEvent("flc-chatbot:ready", {
        detail: { chatbot },
      }),
    );
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initChatbot, { once: true });
  } else {
    initChatbot();
  }
})();
