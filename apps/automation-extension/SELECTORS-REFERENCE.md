# TioRico Panel Selectors - Quick Reference

## Updated Based on Real Panel Testing

This document shows the **actual selectors** used by the extension after testing with the real TioRico panel.

---

## Login Page

```javascript
USERNAME_INPUT: 'input[type="text"][aria-label="Nombre de Usuario"]'
PASSWORD_INPUT: 'input[type="password"][aria-label="Contraseña"]'
SUBMIT_BUTTON: 'button[type="submit"]'
// Fallback: Find button with text "Ingresar"
```

**Workflow:**
1. Fill username
2. Fill password
3. Click "Ingresar" button (or submit)
4. Wait for navigation

---

## Users Page - Credit Loading

### User Search

```javascript
SEARCH_INPUT: '#filter-input'
SEARCH_BUTTON: 'button' // Next to the input (or press Enter)
```

### Action Buttons

```javascript
ADD_CREDITS_BUTTON: '.action-plus'    // Opens add credits modal
SUBTRACT_CREDITS_BUTTON: '.action-minus' // Opens subtract credits modal
```

**Example:**
```javascript
document.querySelector(".action-plus").click()  // Opens modal
```

### Modal (Add Credits Dialog)

```javascript
MODAL: '.modal, [role="dialog"], .modal-dialog'
AMOUNT_INPUT: 'input[aria-label="Username"]'  // ⚠️ Yes, aria-label is "Username" (weird but true!)
SUBMIT_BUTTON: 'button[type="submit"]'
// Or find button with text "Aceptar"
CANCEL_BUTTON: 'button' // With text "Cancelar"
```

**Notes:**
- The amount input has `aria-label="Username"` (not "Amount" or "Monto")
- This is counterintuitive but confirmed working

---

## Complete Workflow (Step by Step)

### 1. Navigate to Users Page
```javascript
// If not already on /users
const usersLink = document.querySelector('a[href*="users"]');
usersLink.click();
```

### 2. Search for User
```javascript
const searchInput = document.querySelector('#filter-input');
searchInput.value = 'targetUsername';
// Press Enter or click search button
searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13 }));
```

### 3. Click Add Credits Button
```javascript
const addButton = document.querySelector('.action-plus');
addButton.click();
// Modal opens
```

### 4. Enter Amount in Modal
```javascript
const amountInput = document.querySelector('input[aria-label="Username"]');
amountInput.value = '100';
```

### 5. Submit
```javascript
// Find "Aceptar" button
const buttons = Array.from(document.querySelectorAll('button'));
const aceptarBtn = buttons.find(btn => btn.textContent.includes('Aceptar'));
aceptarBtn.click();
```

### 6. Verify Success
```javascript
// Look for success message
const successMsg = document.querySelector('.alert-success, .swal2-success');
if (successMsg) {
  console.log('Success:', successMsg.textContent);
}
```

---

## Success/Error Messages

```javascript
SUCCESS_MESSAGE: '.alert-success, .toast-success, .swal2-success, .swal-text'
ERROR_MESSAGE: '.alert-danger, .alert-error, .toast-error, .swal2-error, .swal-text'
```

Common patterns:
- Bootstrap alerts: `.alert-success`, `.alert-danger`
- Toast notifications: `.toast-success`, `.toast-error`
- SweetAlert2: `.swal2-success`, `.swal2-error`
- Generic: `.swal-text` (for both success and error)

---

## Testing Checklist

Use this checklist to verify selectors work:

### Console Tests (Open DevTools → Console)

```javascript
// Test 1: Search input exists
document.querySelector('#filter-input') !== null
// ✅ Should return: true

// Test 2: Add credits button exists (after search)
document.querySelector('.action-plus') !== null
// ✅ Should return: true (after searching for a user)

// Test 3: Modal amount input exists (after opening modal)
document.querySelector('input[aria-label="Username"]') !== null
// ✅ Should return: true (when modal is open)

// Test 4: Submit button in modal
Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Aceptar'))
// ✅ Should return: <button> element (when modal is open)
```

---

## Common Issues & Solutions

### Issue: `.action-plus` not found
**Cause:** User hasn't been searched for yet
**Solution:** Search for a user first, then the action button appears

### Issue: `input[aria-label="Username"]` not found
**Cause:** Modal not open yet
**Solution:** Click `.action-plus` first to open modal

### Issue: Search doesn't trigger
**Cause:** Need to press Enter or click search button
**Solution:** Extension now simulates pressing Enter after typing

### Issue: Success message not detected
**Cause:** Using wrong selector for your notification system
**Solution:** Use DevTools to inspect actual success message element and update selector

---

## Updating Selectors

If you need to change any selector:

1. **Edit file:** `apps/automation-extension/content/panel-automation.js`
2. **Find the SELECTORS object** (lines 4-33)
3. **Update the selector** you need to change
4. **Save file**
5. **Reload extension:**
   - Go to `chrome://extensions`
   - Click refresh icon on extension card
6. **Test again**

---

## Human-Like Behavior

The extension includes delays to mimic human behavior:

- **Random delays:** 2000-7000ms between actions
- **Typing speed:** 50-150ms per character
- **Mouse movement:** Visual highlight before click
- **Review pause:** 3-5 seconds before submitting modal

All delays are randomized to avoid detection patterns.

---

## Last Updated

**Date:** 2026-01-13
**Tested with:** TioRico admin panel (admin.tioricojuegos.com)
**Status:** ✅ Selectors confirmed working
