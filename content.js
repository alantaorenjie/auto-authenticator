/**
 * Content script for Authenticator Extension
 * Handles auto-filling 2FA codes into input fields
 */

// OTP-specific keywords (strong signals)
const OTP_PATTERNS = [
  'otp', 'totp', 'code', '2fa', 'mfa',
  'authenticator', 'token', 'verification',
  'vercode', 'verify', 'auth', 'two.?factor',
  'one.?time', 'pass.?code', 'security.?code',
  '动态码', '动态安全码', '二次验证', '两步验证',
  '身份验证', '身份验证器', 'mfa', '两步认证',
  '安全密钥', 'google.?authenticator'
];

// Broader keywords for fallback detection
const BROAD_PATTERNS = [
  '安全码', '验证码', '6位', '六位',
  '输入.*码', 'code', 'pin', '6-digit',
  '6位.*码', '六位.*码'
];

/**
 * Check if a string matches any of the given patterns
 */
function matchesAny(text, patterns) {
  for (const p of patterns) {
    if (new RegExp(p, 'i').test(text)) return true;
  }
  return false;
}

/**
 * Collect all inputs on the page, including those inside Shadow DOM
 */
function collectAllInputs(root = document) {
  let inputs = [];
  // Standard DOM inputs
  inputs = [...root.querySelectorAll('input, textarea')];
  // Penetrate Shadow DOM roots
  const allElements = root.querySelectorAll('*');
  for (const el of allElements) {
    if (el.shadowRoot) {
      inputs = inputs.concat(collectAllInputs(el.shadowRoot));
    }
  }
  return inputs;
}

/**
 * Get all visible input elements on the page
 */
function getVisibleInputs() {
  const all = collectAllInputs();
  const visible = [];
  for (const el of all) {
    if (el.type === 'hidden') continue;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    if (el.offsetParent === null && el.type !== 'text' && el.type !== 'number' && el.type !== 'tel') continue;
    visible.push(el);
  }
  return visible;
}

/**
 * Get surrounding text context for an input element
 * Looks at placeholder, aria-label, associated label, parent text, nearby siblings
 */
function getInputContext(input) {
  const text = [];

  // Placeholder
  if (input.placeholder) text.push(input.placeholder);
  // aria-label
  const ariaLabel = input.getAttribute('aria-label');
  if (ariaLabel) text.push(ariaLabel);
  // aria-labelledby
  const labelledBy = input.getAttribute('aria-labelledby');
  if (labelledBy) {
    document.querySelectorAll(`[id="${labelledBy}"]`).forEach(el => {
      if (el.textContent) text.push(el.textContent.trim());
    });
  }
  // name / id
  if (input.name) text.push(input.name);
  if (input.id) text.push(input.id);
  // autocomplete
  if (input.autocomplete) text.push(input.autocomplete);

  // <label for="..."> association
  if (input.id) {
    const label = document.querySelector(`label[for="${input.id}"]`);
    if (label && label.textContent) text.push(label.textContent.trim());
  }

  // <label> wrapping this input
  const parentLabel = input.closest('label');
  if (parentLabel && parentLabel.textContent) {
    // Exclude the input's own value from the label text
    const labelText = parentLabel.textContent.replace(input.value || '', '').trim();
    if (labelText) text.push(labelText);
  }

  // Previous sibling element text (common pattern: <span>验证码</span> <input>)
  let prev = input.previousElementSibling;
  if (prev && prev.textContent && prev.textContent.trim().length < 50) {
    text.push(prev.textContent.trim());
  }

  // Parent div text (shallow, for short labels)
  const parent = input.parentElement;
  if (parent) {
    const parentText = Array.from(parent.childNodes)
      .filter(n => n.nodeType === 3) // text nodes only
      .map(n => n.textContent.trim())
      .filter(Boolean)
      .join(' ');
    if (parentText) text.push(parentText);
  }

  // Previous sibling text nodes (e.g., <div>安全码: <input/></div>)
  let sib = input.previousSibling;
  while (sib) {
    if (sib.nodeType === 3 && sib.textContent.trim()) {
      text.push(sib.textContent.trim());
      break;
    }
    sib = sib.previousSibling;
  }

  return text.join(' ').toLowerCase();
}

/**
 * Score an input element for how likely it is a 2FA/OTP field
 */
function scoreInput(input) {
  const context = getInputContext(input);
  let score = 0;

  // Strong OTP-specific match
  if (matchesAny(context, OTP_PATTERNS)) score += 100;
  // Broad keyword match (安全码, 验证码, etc.)
  if (matchesAny(context, BROAD_PATTERNS)) score += 60;

  // Input type hints
  if (input.inputMode === 'numeric') score += 15;
  if (input.type === 'tel') score += 10;
  if (input.type === 'number') score += 10;
  if (input.autocomplete === 'one-time-code') score += 50;

  // MaxLength check (6 is common for OTP codes)
  const maxLen = parseInt(input.maxLength, 10);
  if (maxLen >= 4 && maxLen <= 8) score += 20;
  if (maxLen === 6) score += 15; // Bonus for exactly 6

  // Class/id containing "code" or "otp"
  const cls = (input.className || '').toLowerCase();
  const id = (input.id || '').toLowerCase();
  if (matchesAny(cls, OTP_PATTERNS)) score += 40;
  if (matchesAny(id, OTP_PATTERNS)) score += 40;

  // Negative signals — heavily penalize
  if (context.includes('email') || context.includes('邮箱') || context.includes('mail')) score -= 50;
  if (context.includes('phone') || context.includes('手机') || context.includes('电话')) score -= 50;
  if (context.includes('password') || context.includes('密码')) score -= 50;
  if (context.includes('search') || context.includes('搜索')) score -= 50;
  if (context.includes('username') || context.includes('用户名')) score -= 50;
  if (context.includes('name') || context.includes('姓名') || context.includes('名称')) score -= 50;

  // Prefer shorter inputs (OTP fields are usually short)
  const valLen = input.value ? input.value.length : 0;
  if (valLen > 0 && valLen < 4) score += 5; // partially filled OTP

  return score;
}

/**
 * Check if a set of elements appear to be individual digit inputs
 */
function findDigitGroup(allInputs) {
  const visible = [];
  for (const input of allInputs) {
    if (input.type === 'hidden') continue;
    const style = window.getComputedStyle(input);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    if (!input.offsetParent || input.offsetParent === null) continue;

    // MaxLength check: single-digit inputs typically have maxLength=1 or no maxLength
    const maxLen = parseInt(input.maxLength, 10);
    if (!isNaN(maxLen) && maxLen > 2) continue;

    // Check width — single-char inputs are usually narrow
    const rect = input.getBoundingClientRect();
    if (rect.width < 80 && rect.height > 0) {
      visible.push(input);
    }
  }

  if (visible.length >= 6) {
    // Sort by position (left to right, top to bottom)
    visible.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return ra.top - rb.top || ra.left - rb.left;
    });

    // Check that the first 6 are in a reasonable area (same row)
    const first6 = visible.slice(0, 6);
    const topPos = first6.map(el => el.getBoundingClientRect().top);
    const avgTop = topPos.reduce((a, b) => a + b, 0) / topPos.length;
    const allSameRow = topPos.every(t => Math.abs(t - avgTop) < 5);

    if (allSameRow) {
      return first6;
    }
  }
  return null;
}

/**
 * Find the best 2FA input field in the page
 * @returns {{ element: HTMLInputElement, type: 'single'|'multi', fields: HTMLInputElement[] } | null}
 */
function findOTPField() {
  // 1. Check for six separate digit inputs
  const allInputs = collectAllInputs();
  const digitGroup = findDigitGroup(allInputs);
  if (digitGroup && digitGroup.length === 6) {
    return { type: 'multi', fields: digitGroup, element: digitGroup[0] };
  }

  // 2. Score all visible inputs and pick the best candidate
  const visibleInputs = getVisibleInputs();

  // Filter to only text-like inputs
  const textInputs = visibleInputs.filter(inp => {
    const t = (inp.type || 'text').toLowerCase();
    return ['text', 'number', 'tel', 'email', 'password', ''].includes(t);
  });

  const scored = textInputs.map(inp => ({ input: inp, score: scoreInput(inp) }));

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Return the best candidate only if it has meaningful score
  if (scored.length > 0 && scored[0].score >= 10) {
    return { type: 'single', element: scored[0].input, fields: [scored[0].input] };
  }

  // 3. Last resort: find any visible single text input on the page
  // This handles the case where there's only one input (likely a verification code field)
  const singleInputs = textInputs.filter(inp =>
    parseInt(inp.maxLength, 10) >= 4 && parseInt(inp.maxLength, 10) <= 10
  );

  if (singleInputs.length === 1) {
    return { type: 'single', element: singleInputs[0], fields: [singleInputs[0]] };
  }

  // 4. Truly last resort: if there are just a few inputs total, pick the one
  // with the highest context match using VERY broad heuristics
  // (优先选取输入框提示内容含"6"、"安全码"等字样的输入框)
  for (const candidate of scored) {
    const ctx = getInputContext(candidate.input);
    if (ctx.includes('6') || ctx.includes('六') ||
        ctx.includes('安全码') || ctx.includes('验证码') ||
        ctx.includes('动态码')) {
      return { type: 'single', element: candidate.input, fields: [candidate.input] };
    }
  }

  // If all else fails, just pick the first text-like input with reasonable maxlength
  const anyInput = textInputs.find(inp => {
    const ml = parseInt(inp.maxLength, 10);
    return (ml >= 4 && ml <= 10) || inp.inputMode === 'numeric';
  });
  if (anyInput) {
    return { type: 'single', element: anyInput, fields: [anyInput] };
  }

  return null;
}

/**
 * Fill the OTP code into the found field(s)
 * @param {string} code - The 6-digit OTP code
 */
function fillOTPCode(code) {
  const result = findOTPField();
  if (!result) return false;

  const digits = code.split('');

  if (result.type === 'multi' && result.fields.length >= 6) {
    // Fill each digit into separate input
    for (let i = 0; i < 6; i++) {
      if (result.fields[i]) {
        setNativeValue(result.fields[i], digits[i] || '');
        result.fields[i].dispatchEvent(new Event('change', { bubbles: true }));
        // Focus next empty field
        if (i < 5 && result.fields[i + 1]) {
          result.fields[i + 1].focus();
        }
      }
    }
  } else {
    // Fill the whole code into a single input
    setNativeValue(result.element, code);
    result.element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Focus the first field
  result.element.focus();
  return true;
}

/**
 * Set the native value of an input element and trigger React/Vue reactivity
 */
function setNativeValue(element, value) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  );
  if (nativeSetter) {
    const prototypeSetter = nativeSetter.set;
    prototypeSetter.call(element, value);
  } else {
    element.value = value;
  }

  // Dispatch native InputEvent for React/Vue frameworks
  // React uses native event listeners in React 16+, which pick up InputEvent
  try {
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  } catch {
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// --- Auto-fill on OTP Field Focus ---
// Automatically fills the first account's TOTP code when an OTP input field receives focus.
// Uses a 30-second cooldown to avoid repetitive fills.

let lastAutoFillTime = 0;
const AUTO_FILL_COOLDOWN = 30000; // 30 seconds, matches TOTP refresh

/**
 * Check if an input element appears to be an OTP field
 */
function isOTPInput(el) {
  if (!el || el.tagName !== 'INPUT') return false;
  const t = (el.type || '').toLowerCase();
  if (!['text', 'number', 'tel', 'password', ''].includes(t)) return false;
  if (t === 'password') {
    // Only treat password-type inputs as OTP if they have OTP-specific context
    const score = scoreInput(el);
    return score >= 60;
  }
  const score = scoreInput(el);
  if (score >= 10) return true;

  // Broader fallback: inputMode=numeric + maxLength=6 is a strong OTP signal
  if (el.inputMode === 'numeric') {
    const ml = parseInt(el.maxLength, 10);
    if (ml >= 5 && ml <= 8) return true;
  }

  // Fallback: type="tel" with Chinese OTP context
  if (el.type === 'tel') {
    const ctx = getInputContext(el);
    if (ctx.includes('验证码') || ctx.includes('安全码') || ctx.includes('动态')) return true;
  }

  return false;
}

/**
 * Detect the current login account (email/username) from the page
 * Looks at various signals: filled inputs, page text, URL patterns, etc.
 */
function detectLoginAccount() {
  const candidates = [];

  // 1. Input fields with email/phone/username that already have values
  const inputs = document.querySelectorAll('input[type="email"], input[name*="email" i], input[id*="email" i], input[name*="user" i], input[id*="user" i], input[name*="account" i], input[id*="account" i], input[type="tel"][name*="phone" i], input[type="tel"][id*="phone" i], input[name*="手机" i], input[id*="手机" i], input[name*="邮箱" i], input[id*="邮箱" i]');
  for (const inp of inputs) {
    if (inp.value && inp.value.length > 3 && inp.value.length < 100) {
      const style = window.getComputedStyle(inp);
      if (style.display !== 'none' && style.visibility !== 'hidden') {
        candidates.push(inp.value.trim());
      }
    }
  }

  // 2. Text nodes showing current user (Chinese sites pattern)
  const patterns = [
    /当前[用户账号].*?[：:]\s*(\S+)/i,
    /欢迎[,，]\s*(\S+)/i,
    /您好[,，]\s*(\S+)/i,
    /登录[账号名称].*?[：:]\s*(\S+)/i,
    /账号[：:]?\s*(\S{3,50})/i,
    /welcome.*?[,，]\s*(\S+)/i,
    /signed\s+in\s+as\s+(\S+)/i,
    /logged\s+in\s+as\s+(\S+)/i,
    /account[：:]\s*(\S+)/i,
    /当前身份[：:]\s*(\S+)/i,
    /已登录[：:]\s*(\S+)/i,
    /正在使用[：:]\s*(\S+)/i,
  ];

  // Check visible text in common user-info containers
  const containers = document.querySelectorAll('.user-info, .user-account, .account-info, .nav-user, .topbar-user, [class*="user" i], [id*="user" i], header, .header, .navbar, .topbar');
  for (const container of containers) {
    const text = container.textContent || '';
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1] && match[1].length > 2) {
        candidates.push(match[1]);
      }
    }
  }

  // 3. Check document body for user patterns
  const bodyText = document.body?.textContent || '';
  for (const pattern of patterns) {
    const match = bodyText.match(pattern);
    if (match && match[1] && match[1].length > 2 && match[1].length < 100) {
      // Avoid false positives — only if near top of page or in visible area
      const idx = bodyText.indexOf(match[0]);
      if (idx < 3000) {
        candidates.push(match[1]);
      }
    }
  }

  // 4. Check localStorage for common keys
  try {
    const storageKeys = ['loginAccount', 'userName', 'userEmail', 'account', 'currentAccount', 'loginId', 'user', 'email', 'username'];
    for (const key of storageKeys) {
      const val = localStorage.getItem(key);
      if (val && val.length > 3 && val.length < 100 && /[a-zA-Z0-9@._-]/.test(val)) {
        candidates.push(val);
      }
    }
  } catch {}

  // Return the most likely candidate (first non-empty, prefer email)
  for (const c of candidates) {
    if (c.includes('@')) return c;
  }
  return candidates[0] || null;
}

/**
 * Auto-fill the focused OTP field with the matching account's code
 */
async function autoFillOnFocus(focusedEl) {
  const now = Date.now();
  if (now - lastAutoFillTime < AUTO_FILL_COOLDOWN) return;

  // Don't auto-fill if field already has content
  if (focusedEl.value && focusedEl.value.length >= 3) return;

  lastAutoFillTime = now;

  // Detect the current login account to match against stored accounts
  const accountHint = detectLoginAccount();

  try {
    const res = await chrome.runtime.sendMessage({
      action: 'requestAutoFill',
      accountHint,
      hostname: window.location.hostname
    });
    if (!res || !res.code) return;

    const code = res.code;
    const digits = code.split('');

    // Check if this field is part of a digit group
    const allInputs = collectAllInputs();
    const digitGroup = findDigitGroup(allInputs);
    let filled = false;

    if (digitGroup) {
      // Multi-digit input group (6 separate inputs)
      // Find which input in the group is focused
      const idx = digitGroup.indexOf(focusedEl);
      if (idx !== -1) {
        // Fill from this position onward
        for (let i = idx; i < 6 && i - idx < digits.length; i++) {
          const digitIdx = i - idx;
          if (digitGroup[i]) {
            setNativeValue(digitGroup[i], digits[digitIdx]);
            digitGroup[i].dispatchEvent(new Event('change', { bubbles: true }));
            // Focus the next empty field
            if (i + 1 < 6 && digitGroup[i + 1]) {
              digitGroup[i + 1].focus();
            }
          }
        }
        filled = true;
      }
    }

    if (!filled) {
      // Single input field: fill the entire code
      setNativeValue(focusedEl, code);
      focusedEl.dispatchEvent(new Event('change', { bubbles: true }));
    }
  } catch {
    // Background not available or no accounts
  }
}

// Listen for focus events on potential OTP fields
document.addEventListener('focusin', (e) => {
  const el = e.target;
  if (!isOTPInput(el)) return;
  autoFillOnFocus(el);
});

// Also detect dynamically added OTP fields via MutationObserver
// This handles SPA login flows (e.g., Tencent Cloud, Aliyun) where the
// 2FA step loads dynamically after password verification
let observerTimer = null;
const observer = new MutationObserver((mutations) => {
  // Debounce: coalesce rapid mutations into a single check
  if (observerTimer) return;
  observerTimer = setTimeout(() => {
    observerTimer = null;

    // Strategy 1: If an input is already focused, try to auto-fill
    const focused = document.activeElement;
    if (focused && isOTPInput(focused) && !focused.value) {
      const now = Date.now();
      if (now - lastAutoFillTime >= AUTO_FILL_COOLDOWN) {
        autoFillOnFocus(focused);
        return;
      }
    }

    // Strategy 2: Check if a new input element was added to the page
    const hasNewInput = mutations.some(m =>
      Array.from(m.addedNodes).some(n =>
        n.nodeType === 1 && (n.matches?.('input') || n.querySelector?.('input'))
      )
    );

    if (!hasNewInput && focused) return;

    // Strategy 3: Scan for visible OTP inputs that appeared dynamically
    const now = Date.now();
    if (now - lastAutoFillTime >= AUTO_FILL_COOLDOWN) {
      const inputs = collectAllInputs();
      for (const input of inputs) {
        if (isOTPInput(input) && (input.offsetParent !== null || window.getComputedStyle(input).display !== 'none')) {
          autoFillOnFocus(input);
          break;
        }
      }
    }
  }, 300);
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['style', 'class', 'type', 'inputmode']
});

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'fillOTP':
      const success = fillOTPCode(message.code);
      sendResponse({ success });
      return true;

    case 'checkOTPField':
      const field = findOTPField();
      sendResponse({ hasField: field !== null, type: field?.type || null });
      return true;
  }
});
