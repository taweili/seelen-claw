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

// Seed a sample assistant greeting on init
appendMessage({
  text: "Hello! I'm Claw. How can I help you?",
  type: "assistant",
});

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

    // Clear input and refocus for rapid messaging
    chatInputField.value = "";
    chatInputField.focus();
  });

  // Toggle send button based on input content
  chatInputField.addEventListener("input", () => {
    chatSendBtn.disabled = !chatInputField.value.trim().length;
  });
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

    const rootEl = document.querySelector(".chat-root");
    if (rootEl) {
      rootEl.style.background = bgColor;
    }
  } catch {
    // Settings not available — widget still initializes with defaults
  }

  await widget.init({
    autoSizeByContent: document.querySelector(".chat-root"),
    autoSizeFitOnScreen: true,
    normalizeDevicePixelRatio: true,
  });

  await widget.ready({ show: true });
}

main();
