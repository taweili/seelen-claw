import { Widget } from "@seelen-ui/lib";

/**
 * Create a chat message DOM element.
 * @param {string} text - The message text content.
 * @param {'user'|'assistant'} type - The message sender type.
 * @returns {HTMLLIElement|null} The message list item, or null if text is empty/null.
 */
export function renderMessage(text, type) {
  if (!text || typeof text !== "string" || !text.trim()) {
    return null;
  }

  const li = document.createElement("li");
  li.className = `chat-message chat-message-${type}`;

  const bubble = document.createElement("div");
  bubble.className = `chat-bubble chat-bubble-${type}`;
  bubble.textContent = text;

  li.appendChild(bubble);
  return li;
}

/**
 * Append a message to the chat and scroll to bottom.
 * @param {{ text: string, type: 'user'|'assistant' }} msg - Message object.
 */
export function appendMessage(msg) {
  const el = renderMessage(msg.text, msg.type);
  if (!el) return;

  const messageList = document.getElementById("chat-messages");
  if (!messageList) return;

  messageList.appendChild(el);

  // Use requestAnimationFrame to ensure layout is computed before reading scrollHeight
  requestAnimationFrame(() => {
    messageList.scrollTop = messageList.scrollHeight;
  });
}

// ---------------------------------------------------------------------------
// AgentClient interface (JSDoc type) — for M003 drop-in replacement
// ---------------------------------------------------------------------------
/**
 * @typedef {object} AgentClient
 * @description Interface for agent communication. Implementations replace
 *   the mock agent in M003.
 * @method {function(string): Promise<string>} sendMessage - Send a message
 *   to the agent and return the response.
 */

// ---------------------------------------------------------------------------
// MockAgent — implements AgentClient for M002 demo
// ---------------------------------------------------------------------------
/**
 * Mock agent that returns randomized text with simulated delay.
 * Used for M002 demo; replaced by real agent client in M003.
 * @implements {AgentClient}
 */
const MockAgent = {
  /** Randomized responses for demo variety */
  RESPONSES: [
    "That's interesting! Tell me more.",
    "I see what you mean. Let me think about that.",
    "Great point! Here's my take on it...",
    "I understand. Would you like me to elaborate?",
    "Thanks for sharing that. Here's what I think...",
    "That's a good question. Let me break it down.",
    "I appreciate your input. Here's my perspective.",
    "Interesting! Let me process that for you.",
    "Got it. Here's my response to that.",
    "That makes sense. Let me respond...",
  ],

  /**
   * Send a message and return a randomized mock response.
   * @param {string} text - The user's message.
   * @returns {Promise<string>} A mock agent response.
   */
  async sendMessage(text) {
    const delay = 500 + Math.random() * 1000; // 500-1500ms
    await new Promise((resolve) => setTimeout(resolve, delay));
    const response =
      this.RESPONSES[Math.floor(Math.random() * this.RESPONSES.length)];
    return response;
  },
};

// Form submit handler: send message on submit or Enter key
const chatInput = document.getElementById("chat-input");
const chatInputField = document.getElementById("chat-input-field");
const chatSendBtn = document.getElementById("chat-send-btn");

if (chatInput && chatInputField && chatSendBtn) {
  chatInput.addEventListener("submit", (e) => {
    e.preventDefault();
    const trimmed = chatInputField.value.trim();
    if (!trimmed) return;

    // Enforce 400 character limit (truncate to be user-friendly)
    const text = trimmed.length > 400 ? trimmed.slice(0, 400) : trimmed;

    appendMessage({ text, type: "user" });

    // Call mock agent and append response
    MockAgent.sendMessage(text).then((response) => {
      appendMessage({ text: response, type: "assistant" });
    });

    // Clear input and refocus for rapid messaging
    chatInputField.value = "";
    chatInputField.focus();
  });

  // Toggle send button based on input content
  chatInputField.addEventListener("input", () => {
    chatSendBtn.disabled = !chatInputField.value.trim().length;
  });
}

// ---------------------------------------------------------------------------
// Settings helpers — readSettings, listenForSettingsChanges
// ---------------------------------------------------------------------------

/**
 * Read agent URL and auth token from widget config.
 * @param {object} widgetConfig - Current widget config from Settings API.
 * @returns {{ agentUrl: string, authToken: string }} Parsed settings.
 */
export function readSettings(widgetConfig) {
  return {
    agentUrl: widgetConfig["agent-url"] || "",
    authToken: widgetConfig["auth-token"] || "",
  };
}

/**
 * Register a listener for settings changes.
 * @param {function({ agentUrl: string, authToken: string }): void} onChange - Callback invoked on change.
 */
export function listenForSettingsChanges(onChange) {
  try {
    // Lazy import — may not be available in all Seelen UI environments (MEM015)
    import("@seelen-ui/lib").then(({ Settings }) => {
      Settings.onChange((settings) => {
        const widgetConfig = settings.getCurrentWidgetConfig();
        const newSettings = readSettings(widgetConfig);
        console.log("[settings] config changed:", { agentUrl: newSettings.agentUrl });
        onChange(newSettings);
      });
    });
  } catch {
    // Settings API not available — silently skip onChange registration
  }
}

// Initialize the Seelen widget
async function main() {
  const widget = Widget.getCurrent();

  // Lazy settings import — may not be available in all Seelen UI environments (MEM015)
  try {
    const { Settings } = await import("@seelen-ui/lib");
    const settings = await Settings.getAsync();
    const widgetConfig = settings.getCurrentWidgetConfig();
    const bgColor = widgetConfig["background-color"] || "#ffe600";

    // Read initial settings (MEM016: capture baseline before onChange fires)
    const initialSettings = readSettings(widgetConfig);
    console.log("[settings] initial config:", { agentUrl: initialSettings.agentUrl });

    // Register settings change listener (MEM016: baseline captured above)
    listenForSettingsChanges((newSettings) => {
      console.log("[settings] config changed:", { agentUrl: newSettings.agentUrl });
      // Update background color if it changed
      const newBg = newSettings["background-color"] || bgColor;
      const rootEl = document.querySelector(".chat-root");
      if (rootEl) {
        rootEl.style.background = newBg;
      }
    });

    const rootEl = document.querySelector(".chat-root");
    if (rootEl) {
      rootEl.style.background = bgColor;
    }
  } catch (error) {
    // Settings not available — display error as chat message
    const errorMsg = error instanceof Error ? error.message : "Failed to load settings";
    appendMessage({ text: errorMsg, type: "assistant" });
  }

  await widget.init({
    autoSizeByContent: document.querySelector(".chat-root"),
    autoSizeFitOnScreen: true,
    normalizeDevicePixelRatio: true,
  });

  await widget.ready({ show: true });
}

main();
