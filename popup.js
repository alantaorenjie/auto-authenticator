import { generateTOTP, getTimeRemaining, getTOTPProgress, parseOTPAuthURI } from './totp.js';

// --- State ---
let accounts = [];
let editMode = false;
let updateInterval = null;
let scanCancelled = false;

// --- DOM refs ---
const $ = (id) => document.getElementById(id);
const accountList = $('accountList');
const emptyState = $('emptyState');
const toast = $('toast');

// --- Init ---
document.addEventListener('DOMContentLoaded', async () => {
  await loadAccounts();
  renderAccounts();
  startUpdates();

  // Button handlers
  $('btnSettings').addEventListener('click', openSettings);
  $('btnScan').addEventListener('click', startScan);
  $('btnEdit').addEventListener('click', toggleEditMode);
});

// --- Storage ---
async function loadAccounts() {
  const res = await chrome.runtime.sendMessage({ action: 'getAccounts' });
  accounts = res.accounts || [];
}

async function saveAccounts() {
  await chrome.runtime.sendMessage({ action: 'saveAccounts', accounts });
}

// --- Render ---
let draggedId = null;

function renderAccounts() {
  // Remove old cards (keep empty state)
  document.querySelectorAll('.account-card').forEach(el => el.remove());

  const sorted = [...accounts].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return (a.order || a.createdAt || 0) - (b.order || b.createdAt || 0);
  });

  if (sorted.length === 0) {
    emptyState.style.display = 'flex';
    return;
  }

  emptyState.style.display = 'none';

  sorted.forEach((account, i) => {
    const card = createCard(account, i);
    accountList.appendChild(card);
  });

  // Generate codes for all cards
  updateCodes();
}

function createCard(account, index) {
  const card = document.createElement('div');
  card.className = 'account-card';
  card.dataset.id = account.id || index;

  const displayIssuer = account.issuer || '未知';
  const displayAccount = account.account || '';

  // Format code with a space in the middle (289 923)
  const codePart1 = '000';
  const codePart2 = '000';

  card.innerHTML = `
    <div class="card-header">
      <span class="card-drag-handle" draggable="true" title="拖动排序">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/>
          <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
          <circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/>
        </svg>
      </span>
      <span class="card-issuer">${escapeHtml(displayIssuer)}</span>
      <div class="card-header-right" style="display:flex;align-items:center;gap:4px;">
        ${editMode ? `
          <button class="card-delete-btn show" data-action="delete">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        ` : `
          <button class="card-pin-btn ${account.pinned ? 'pinned' : ''}" data-action="pin">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="${account.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2z"/>
            </svg>
          </button>
        `}
      </div>
    </div>
    <div class="card-code-row">
      <span class="card-code" data-action="copy">
        <span class="code-part1">${codePart1}</span>&thinsp;<span class="code-part2">${codePart2}</span>
      </span>
      <div class="code-progress">
        <svg width="36" height="36" viewBox="0 0 36 36">
          <circle class="code-progress-bg" cx="18" cy="18" r="15"/>
          <circle class="code-progress-bar" cx="18" cy="18" r="15"
            stroke-dasharray="${2 * Math.PI * 15}"
            stroke-dashoffset="0"/>
        </svg>
      </div>
    </div>
    ${displayAccount ? `<div class="card-account">${escapeHtml(displayAccount)}</div>` : ''}
    <div class="card-actions">
      <button class="card-action-btn" data-action="copy">
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        复制
      </button>
      <button class="card-action-btn" data-action="fill">
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        填充
      </button>
    </div>
  `;

  // --- Drag-and-Drop ---
  const handle = card.querySelector('.card-drag-handle');

  handle.addEventListener('dragstart', (e) => {
    draggedId = card.dataset.id;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.dataset.id);
    // Fix ghost image for small popup
    try {
      const ghost = card.cloneNode(true);
      ghost.style.position = 'absolute';
      ghost.style.top = '-1000px';
      ghost.style.width = card.offsetWidth + 'px';
      ghost.style.opacity = '0.7';
      ghost.style.borderRadius = '8px';
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 20, 20);
      setTimeout(() => ghost.remove(), 0);
    } catch {}
  });

  handle.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    document.querySelectorAll('.account-card').forEach(c => c.classList.remove('drag-over'));
    draggedId = null;
  });

  // Card-level drop zone
  card.addEventListener('dragover', (e) => {
    if (!draggedId || draggedId === card.dataset.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.account-card').forEach(c => c.classList.remove('drag-over'));
    card.classList.add('drag-over');
  });

  card.addEventListener('dragleave', () => {
    card.classList.remove('drag-over');
  });

  card.addEventListener('drop', (e) => {
    e.preventDefault();
    card.classList.remove('drag-over');
    if (!draggedId || draggedId === card.dataset.id) return;
    handleReorder(draggedId, card.dataset.id);
  });

  // --- Click to fill ---
  card.addEventListener('click', (e) => {
    // Ignore clicks on the drag handle
    if (e.target.closest('.card-drag-handle')) return;

    const actionBtn = e.target.closest('[data-action]');
    const code = card.querySelector('.card-code').dataset.code;

    if (actionBtn) {
      switch (actionBtn.dataset.action) {
        case 'copy':
          handleCopy(code, card);
          return;
        case 'fill':
          handleFill(code);
          return;
        case 'pin':
          handlePin(account.id);
          return;
        case 'delete':
          handleDelete(account.id, card);
          return;
      }
    }

    // Default: click anywhere on the card triggers fill
    if (code) handleFill(code);
  });

  return card;
}

function handleReorder(fromId, toId) {
  const fromIdx = accounts.findIndex(a => a.id === fromId);
  const toIdx = accounts.findIndex(a => a.id === toId);
  if (fromIdx === -1 || toIdx === -1) return;

  // Move the account in the array
  const [moved] = accounts.splice(fromIdx, 1);
  const newToIdx = accounts.findIndex(a => a.id === toId);
  accounts.splice(newToIdx, 0, moved);

  // Recalculate order values based on current position
  const sorted = [...accounts].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return (a.order || a.createdAt || 0) - (b.order || b.createdAt || 0);
  });

  sorted.forEach((a, i) => {
    a.order = (i + 1) * 1000;
  });

  saveAccounts().then(() => {
    renderAccounts();
    startUpdates();
  });
}

// --- Code Update Loop ---
function startUpdates() {
  if (updateInterval) clearInterval(updateInterval);
  updateCodes();
  updateInterval = setInterval(updateCodes, 1000);
}

async function updateCodes() {
  for (const card of document.querySelectorAll('.account-card')) {
    const id = card.dataset.id;
    if (!id) continue;
    const account = accounts.find(a => a.id === id);
    if (!account) continue;

    try {
      const code = await generateTOTP(account.secret);
      const progress = getTOTPProgress();
      const remaining = 30 - Math.floor(progress * 30);

      // Update code display
      const codeEl = card.querySelector('.card-code');
      const part1 = codeEl.querySelector('.code-part1');
      const part2 = codeEl.querySelector('.code-part2');
      codeEl.dataset.code = code;
      part1.textContent = code.substring(0, 3);
      part2.textContent = code.substring(3);

      // Update progress circle
      const circle = card.querySelector('.code-progress-bar');
      const circumference = 2 * Math.PI * 15;
      const offset = circumference * (1 - progress);
      circle.style.strokeDashoffset = offset;

      // Color based on time remaining
      circle.classList.remove('warning', 'critical');
      if (remaining <= 5) {
        circle.classList.add('critical');
      } else if (remaining <= 10) {
        circle.classList.add('warning');
      }
    } catch (err) {
      console.error('TOTP error:', err);
    }
  }
}

// --- Actions ---
async function handleCopy(code, cardEl) {
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    showToast('已复制');

    const codeEl = cardEl.querySelector('.card-code');
    codeEl.classList.remove('copied');
    // Force reflow
    void codeEl.offsetWidth;
    codeEl.classList.add('copied');
  } catch {
    showToast('复制失败');
  }
}

async function handleFill(code) {
  if (!code) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      showToast('未找到当前标签页');
      return;
    }

    // Inject content script on-demand (activeTab + scripting permission)
    // This avoids needing <all_urls> host_permissions
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    } catch {
      // Script may already be injected, that's fine
    }

    // Give it a moment to initialize, then send the fill message
    await new Promise(r => setTimeout(r, 50));

    const res = await chrome.tabs.sendMessage(tab.id, {
      action: 'fillOTP',
      code
    });
    if (res?.success) {
      showToast('已填充验证码');
    } else {
      showToast('未找到验证码输入框');
    }
  } catch {
    showToast('无法填充，请刷新页面重试');
  }
}

function handlePin(accountId) {
  const account = accounts.find(a => a.id === accountId);
  if (!account) return;

  // If currently editing, handle differently
  if (editMode) return;

  account.pinned = !account.pinned;
  saveAccounts().then(() => {
    renderAccounts();
    startUpdates();
  });
}

function handleDelete(accountId, cardEl) {
  if (!confirm('确定要删除此账号吗？')) return;

  cardEl.classList.add('deleting');
  setTimeout(() => {
    accounts = accounts.filter(a => a.id !== accountId);
    saveAccounts().then(() => {
      renderAccounts();
      startUpdates();
    });
  }, 250);
}

// --- Edit Mode ---
function toggleEditMode() {
  editMode = !editMode;
  $('btnEdit').style.color = editMode ? 'var(--accent)' : '';

  if (editMode) {
    // Enable edit mode: show delete buttons, remove pin capability
    // Add a header indicator
  }

  renderAccounts();
  startUpdates();
}

// --- QR Scanning ---
async function startScan() {
  scanCancelled = false;
  const overlay = document.createElement('div');
  overlay.className = 'scan-overlay';
  overlay.innerHTML = `
    <div class="scan-spinner"></div>
    <div class="scan-status">正在扫描当前页面二维码...</div>
    <button class="scan-cancel-btn">取消</button>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('.scan-cancel-btn').addEventListener('click', () => {
    scanCancelled = true;
    overlay.remove();
  });

  try {
    const res = await chrome.runtime.sendMessage({ action: 'captureTab' });
    if (scanCancelled) return;

    if (res.error) {
      overlay.querySelector('.scan-status').textContent = '截图失败';
      overlay.querySelector('.scan-spinner').style.display = 'none';
      overlay.innerHTML += `<div class="scan-error">${escapeHtml(res.error)}</div>`;
      setTimeout(() => overlay.remove(), 2000);
      return;
    }

    // Create image from data URL
    const img = await createImageFromDataUrl(res.dataUrl);

    if (scanCancelled) return;

    // Try BarcodeDetector API
    try {
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      const barcodes = await detector.detect(img);

      if (scanCancelled) return;

      if (barcodes.length === 0) {
        overlay.querySelector('.scan-status').textContent = '未识别到二维码';
        setTimeout(() => overlay.remove(), 1500);
        return;
      }

      const rawValue = barcodes[0].rawValue;
      const parsed = parseOTPAuthURI(rawValue);

      if (!parsed || !parsed.secret) {
        overlay.querySelector('.scan-status').textContent = '二维码不是有效的 TOTP 密钥';
        setTimeout(() => overlay.remove(), 2000);
        return;
      }

      // Add account
      const maxOrder = accounts.reduce((m, a) => Math.max(m, a.order || a.createdAt || 0), 0);
      const newAccount = {
        id: Date.now().toString(),
        issuer: parsed.issuer,
        account: parsed.account,
        secret: parsed.secret,
        pinned: false,
        order: maxOrder + 1000,
        createdAt: Date.now()
      };

      accounts.push(newAccount);
      await saveAccounts();

      overlay.querySelector('.scan-status').textContent = `已添加: ${parsed.issuer}`;
      overlay.querySelector('.scan-spinner').style.display = 'none';
      setTimeout(() => {
        overlay.remove();
        renderAccounts();
        startUpdates();
      }, 1000);

    } catch (detectErr) {
      overlay.querySelector('.scan-status').textContent = '扫码识别不可用';
      overlay.querySelector('.scan-spinner').style.display = 'none';
      overlay.innerHTML += `<div class="scan-error">当前浏览器不支持 BarcodeDetector API，请手动添加密钥。</div>`;
      setTimeout(() => overlay.remove(), 2500);
    }

  } catch (err) {
    overlay.querySelector('.scan-status').textContent = '扫描失败';
    overlay.querySelector('.scan-spinner').style.display = 'none';
    overlay.innerHTML += `<div class="scan-error">${escapeHtml(err.message)}</div>`;
    setTimeout(() => overlay.remove(), 2000);
  }
}

function createImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// --- Settings ---
function openSettings() {
  // Open settings page as a new tab
  chrome.tabs.create({ url: 'settings.html' });
}

// --- Toast ---
let toastTimeout = null;

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 1500);
}

// --- Utils ---
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
