import { Widget } from "@seelen-ui/lib";

/**
 * Minimal markdown-to-HTML renderer for assistant messages.
 * Supports: headings, bold, italic, code, inline code, lists, links, blockquotes, horizontal rules.
 * @param {string} md - Markdown text.
 * @returns {string} HTML string.
 */
function renderMarkdown(md) {
  let html = md;

  // Escape HTML entities first (but preserve markdown syntax)
  html = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  // Headings
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  // Horizontal rules
  html = html.replace(/^---$/gm, "<hr>");

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Blockquotes
  html = html.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");

  // Unordered lists
  html = html.replace(/^[-*] (.+)$/gm, "<li>$1</li>");
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>");

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");

  // Paragraphs: wrap remaining standalone lines
  html = html.replace(/^(?!<)(.+)$/gm, "<p>$1</p>");

  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, "");

  // Merge adjacent block-level elements separated by newlines
  html = html.replace(/\n/g, "");

  return html;
}

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

  if (type === "assistant") {
    // Render markdown for assistant messages
    bubble.innerHTML = renderMarkdown(text);
  } else {
    // Plain text for user messages
    bubble.textContent = text;
  }

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
  /** Markdown-rich responses for demo variety */
  RESPONSES: [
    `### Great question! 🎯

Here's my take on it:

- **First**, consider the architecture
- **Second**, think about scalability
- ***Finally***, test thoroughly

> "The best code is the code you don't write."

Check out the [docs](https://example.com) for more info.`,

    `## Let me break it down

| Feature | Status |
|---------|--------|
| Auth    | ✅ Done |
| Cache   | 🔄 WIP  |
| Deploy  | ⏳ Pending |

\`\`\`javascript
const result = await fetch('/api/data');
console.log(result.status);
\`\`\`

---

*Let me know if you need more details!*`,

    `I see what you mean. Here are some **key points**:

1. Start with \`npm install\`
2. Run the build: \`npm run build\`
3. Deploy with \`seelen-ui load\`

### Pro Tips

- Use \`--watch\` mode during development
- Always **validate** your config before deploying
- Keep dependencies *up to date*

> 💡 Tip: Run \`npm audit\` regularly to catch vulnerabilities.`,

    `## Quick Summary

Here's what I found:

- **Performance**: The widget loads in \`< 100ms\`
- **Bundle size**: ~\`15KB\` gzipped
- **Dependencies**: Only \`@seelen-ui/lib\`

\`\`\`css
.chat-bubble {
  border-radius: 18px;
  padding: 10px 14px;
}
\`\`\`

---

*Need more info? Just ask!*`,

    `Thanks for sharing! Here's **my perspective**:

### Architecture Overview

\`\`\`
User Input → MockAgent → renderMessage → DOM
\`\`\`

Key decisions:

- ***Markdown rendering*** for assistant messages
- Plain text for user messages
- Settings loaded via \`Settings API\`

> "Simplicity is the ultimate sophistication." — Leonardo da Vinci`,
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
