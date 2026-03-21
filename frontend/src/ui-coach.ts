/**
 * AI Coach chat UI.
 * Renders a chat interface where users can ask questions about their training.
 */

import { escapeHtml } from './ui-utilities';
import {
  buildCoachContext, getOfflineResponse, sendToClaudeAPI,
  getApiKey, saveApiKey, clearApiKey,
  loadChatHistory, saveChatHistory, clearChatHistory,
} from './ai-coach';
import type { CoachMessage } from './ai-coach';

export function initCoachUI(): void {
  const container = document.getElementById('coach-section');
  if (!container) return;

  const history = loadChatHistory();
  renderChat(container, history);
}

function renderChat(container: HTMLElement, messages: CoachMessage[]): void {
  const apiKey = getApiKey();
  const hasKey = !!apiKey;

  let html = `
    <div class="coach-header">
      <h3 class="section-heading" style="margin:0;">AI Coach</h3>
      <p class="coach-subtitle">Ask anything about your training, form, program, or nutrition.</p>
      ${!hasKey ? `
        <details class="coach-api-setup">
          <summary style="cursor:pointer;color:var(--accent);font-size:var(--font-xs);">Enable AI mode (optional)</summary>
          <div style="padding:var(--space-sm) 0;">
            <p style="font-size:var(--font-xs);color:var(--text-muted);margin-bottom:var(--space-xs);">Enter your Anthropic API key for advanced AI coaching. Without it, the coach uses smart offline responses based on your training data. Your key is stored locally and never sent anywhere except Anthropic's API.</p>
            <input id="coach-api-key-input" type="password" class="form-input" placeholder="sk-ant-..." style="margin-bottom:var(--space-xs);" />
            <p style="font-size:var(--font-2xs);color:var(--warning);margin-top:var(--space-xs);">Security note: Your API key is stored locally in your browser. Do not use this on shared or public computers. The key is only sent to Anthropic's API — never to our servers.</p>
            <button id="coach-save-key" class="btn btn-primary" style="font-size:var(--font-xs);margin-top:var(--space-xs);">Save Key</button>
          </div>
        </details>
      ` : `
        <div style="font-size:var(--font-xs);color:var(--success);">AI mode active (Claude Haiku) <button id="coach-clear-key" style="color:var(--text-muted);background:none;border:none;cursor:pointer;text-decoration:underline;font-size:var(--font-xs);">disconnect</button></div>
      `}
    </div>

    <div class="coach-messages" id="coach-messages">
  `;

  if (messages.length === 0) {
    html += `
      <div class="coach-welcome">
        <p>I'm your AI lifting coach. I have access to your form analysis scores, training history, PRs, and program data.</p>
        <div class="coach-suggestions">
          <button class="coach-suggestion" data-q="How's my form?">How's my form?</button>
          <button class="coach-suggestion" data-q="How am I progressing?">How am I progressing?</button>
          <button class="coach-suggestion" data-q="How to squat properly?">How to squat?</button>
          <button class="coach-suggestion" data-q="Should I change programs?">Should I change programs?</button>
          <button class="coach-suggestion" data-q="I'm feeling tired, do I need a deload?">Do I need a deload?</button>
          <button class="coach-suggestion" data-q="What should I eat?">What should I eat?</button>
        </div>
      </div>
    `;
  } else {
    for (const msg of messages) {
      const isCoach = msg.role === 'coach';
      html += `
        <div class="coach-msg ${isCoach ? 'coach-msg-coach' : 'coach-msg-user'}">
          <div class="coach-msg-content">${isCoach ? formatCoachResponse(msg.content) : escapeHtml(msg.content)}</div>
          ${msg.dataSources?.length ? `<div class="coach-msg-sources">Data: ${msg.dataSources.join(', ')}</div>` : ''}
        </div>
      `;
    }
  }

  html += `
    </div>

    <div class="coach-input-row">
      <input type="text" id="coach-input" class="coach-input" placeholder="Ask your coach..." autocomplete="off" />
      <button id="coach-send" class="coach-send-btn">Send</button>
      ${messages.length > 0 ? '<button id="coach-clear-chat" class="coach-clear-btn" title="Clear chat history">Clear</button>' : ''}
    </div>
  `;

  container.innerHTML = html;

  // Wire events
  const input = document.getElementById('coach-input') as HTMLInputElement;
  const sendBtn = document.getElementById('coach-send') as HTMLButtonElement;

  const sendMessage = async (): Promise<void> => {
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    const userMsg: CoachMessage = { role: 'user', content: text, timestamp: new Date().toISOString() };
    messages.push(userMsg);

    // Show user message immediately
    const messagesEl = document.getElementById('coach-messages');
    if (messagesEl) {
      // Remove welcome if present
      const welcome = messagesEl.querySelector('.coach-welcome');
      if (welcome) welcome.remove();

      messagesEl.innerHTML += `<div class="coach-msg coach-msg-user"><div class="coach-msg-content">${escapeHtml(text)}</div></div>`;
      messagesEl.innerHTML += `<div class="coach-msg coach-msg-coach coach-typing"><div class="coach-msg-content">Thinking...</div></div>`;
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // Get response
    const context = buildCoachContext();
    const key = getApiKey();

    let response: CoachMessage;
    if (key) {
      response = await sendToClaudeAPI(messages, context, key);
    } else {
      response = getOfflineResponse(text, context);
    }

    messages.push(response);
    saveChatHistory(messages);

    // Remove typing indicator and show response
    if (messagesEl) {
      const typing = messagesEl.querySelector('.coach-typing');
      if (typing) typing.remove();
      messagesEl.innerHTML += `
        <div class="coach-msg coach-msg-coach">
          <div class="coach-msg-content">${formatCoachResponse(response.content)}</div>
          ${response.dataSources?.length ? `<div class="coach-msg-sources">Data: ${response.dataSources.join(', ')}</div>` : ''}
        </div>
      `;
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  };

  sendBtn?.addEventListener('click', () => { void sendMessage(); });
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); void sendMessage(); }
  });

  // Suggestion buttons
  container.querySelectorAll<HTMLButtonElement>('.coach-suggestion').forEach(btn => {
    btn.addEventListener('click', () => {
      if (input) { input.value = btn.dataset.q ?? ''; void sendMessage(); }
    });
  });

  // API key management
  document.getElementById('coach-save-key')?.addEventListener('click', () => {
    const keyInput = document.getElementById('coach-api-key-input') as HTMLInputElement;
    if (keyInput?.value?.startsWith('sk-')) {
      saveApiKey(keyInput.value);
      renderChat(container, messages);
    }
  });

  document.getElementById('coach-clear-key')?.addEventListener('click', () => {
    clearApiKey();
    renderChat(container, messages);
  });

  // Clear chat history — re-render with empty messages to show welcome screen
  document.getElementById('coach-clear-chat')?.addEventListener('click', () => {
    clearChatHistory();
    messages.length = 0;
    renderChat(container, []);
  });

  // Scroll to bottom
  const messagesEl = document.getElementById('coach-messages');
  if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;

  // Focus input
  input?.focus();
}

function formatCoachResponse(content: string): string {
  // Convert markdown-like formatting to HTML
  let html = escapeHtml(content);
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Bullet points
  html = html.replace(/^\u2022 /gm, '<span class="coach-bullet">\u2022</span> ');
  // Line breaks
  html = html.replace(/\n/g, '<br>');
  return html;
}

// --- CSS ---

export function injectCoachStyles(): void {
  if (document.getElementById('coach-styles')) return;
  const style = document.createElement('style');
  style.id = 'coach-styles';
  style.textContent = `
    .coach-header { margin-bottom: var(--space-md); }
    .coach-subtitle { font-size: var(--font-sm); color: var(--text-muted); margin-top: var(--space-xs); }
    .coach-messages {
      min-height: 300px;
      max-height: 60vh;
      overflow-y: auto;
      padding: var(--space-sm);
      background: var(--bg-primary);
      border-radius: var(--radius-md);
      border: 1px solid var(--border);
      margin-bottom: var(--space-sm);
      display: flex;
      flex-direction: column;
      gap: var(--space-sm);
    }
    .coach-msg {
      max-width: 85%;
      padding: var(--space-sm) var(--space-md);
      border-radius: var(--radius-md);
      font-size: var(--font-sm);
      line-height: 1.6;
    }
    .coach-msg-user {
      align-self: flex-end;
      background: var(--accent);
      color: var(--bg-primary);
      border-bottom-right-radius: var(--radius-sm);
    }
    .coach-msg-coach {
      align-self: flex-start;
      background: var(--bg-card);
      color: var(--text-primary);
      border: 1px solid var(--border);
      border-bottom-left-radius: var(--radius-sm);
    }
    .coach-msg-sources {
      font-size: var(--font-2xs);
      color: var(--text-muted);
      margin-top: var(--space-xs);
      font-style: italic;
    }
    .coach-typing .coach-msg-content {
      opacity: 0.6;
      animation: wp-pulse 1s infinite;
    }
    .coach-bullet { color: var(--accent); font-weight: 700; }
    .coach-input-row {
      display: flex;
      gap: var(--space-xs);
    }
    .coach-input {
      flex: 1;
      padding: var(--space-sm) var(--space-md);
      border-radius: var(--radius-md);
      border: 1px solid var(--border);
      background: var(--bg-input);
      color: var(--text-primary);
      font-size: var(--font-sm);
      min-height: 44px;
    }
    .coach-input:focus { outline: 2px solid var(--accent); border-color: var(--accent); }
    .coach-send-btn {
      padding: var(--space-sm) var(--space-md);
      border-radius: var(--radius-md);
      background: var(--accent);
      color: var(--bg-primary);
      border: none;
      font-weight: 700;
      cursor: pointer;
      min-height: 44px;
      min-width: 60px;
      transition: background var(--transition-fast);
    }
    .coach-send-btn:hover { background: var(--accent-hover); }
    .coach-clear-btn {
      padding: var(--space-sm);
      border-radius: var(--radius-md);
      background: transparent;
      color: var(--text-muted);
      border: 1px solid var(--border);
      cursor: pointer;
      min-height: 44px;
      font-size: var(--font-xs);
      transition: color var(--transition-fast), border-color var(--transition-fast);
    }
    .coach-clear-btn:hover { color: var(--danger); border-color: var(--danger); }
    .coach-welcome {
      text-align: center;
      padding: var(--space-lg);
      color: var(--text-secondary);
      font-size: var(--font-sm);
    }
    .coach-suggestions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-xs);
      justify-content: center;
      margin-top: var(--space-md);
    }
    .coach-suggestion {
      padding: var(--space-xs) var(--space-sm);
      border-radius: 999px;
      border: 1px solid var(--border);
      background: var(--bg-card);
      color: var(--text-secondary);
      font-size: var(--font-xs);
      cursor: pointer;
      transition: border-color var(--transition-fast), color var(--transition-fast);
    }
    .coach-suggestion:hover {
      border-color: var(--accent);
      color: var(--accent);
    }
    .coach-api-setup {
      margin-top: var(--space-sm);
      font-size: var(--font-xs);
    }
    @media (max-width: 500px) {
      .coach-msg { max-width: 92%; }
      .coach-suggestions { flex-direction: column; }
    }
  `;
  document.head.appendChild(style);
}
