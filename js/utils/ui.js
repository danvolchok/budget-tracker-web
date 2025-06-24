// UI utility functions
import { CONFIG } from '../../config/settings.js';

export class UI {
  static showLoading(text = 'Loading...') {
    const overlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');
    if (overlay && loadingText) {
      loadingText.textContent = text;
      overlay.style.display = 'flex';
    }
    
    // Reset progress and stats
    this.setProgress(0);
    this.setStep(1, 'Connecting...');
    this.resetStats();
  }

  static hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  static setProgress(percentage) {
    const fill = document.getElementById('progress-fill');
    const text = document.getElementById('progress-text');
    
    if (fill) fill.style.width = `${percentage}%`;
    if (text) text.textContent = `${Math.round(percentage)}%`;
  }

  static setStep(stepNumber, stepText) {
    const stepElement = document.getElementById('current-step');
    if (stepElement) {
      stepElement.textContent = `Step ${stepNumber} of 5: ${stepText}`;
    }
  }

  static updateStats(transactions, merchants, cleaned) {
    const transactionCount = document.getElementById('transaction-count');
    const merchantCount = document.getElementById('merchant-count');
    const cleanedCount = document.getElementById('cleaned-count');
    
    if (transactionCount && transactions !== undefined) {
      transactionCount.textContent = transactions.toLocaleString();
    }
    if (merchantCount && merchants !== undefined) {
      merchantCount.textContent = merchants.toLocaleString();
    }
    if (cleanedCount && cleaned !== undefined) {
      cleanedCount.textContent = cleaned.toLocaleString();
    }
  }

  static resetStats() {
    this.updateStats(0, 0, 0);
  }

  static setLoadingMessage(message) {
    const text = document.getElementById('loading-text');
    if (text) text.textContent = message;
  }

  static showEnterAppButton() {
    // Hide loading elements
    const spinner = document.querySelector('.loading-spinner');
    const currentStep = document.getElementById('current-step');
    const loadingText = document.getElementById('loading-text');
    
    if (spinner) spinner.style.display = 'none';
    if (currentStep) currentStep.style.display = 'none';
    if (loadingText) loadingText.style.display = 'none';
    
    // Show enter app section
    const enterSection = document.getElementById('enter-app-section');
    if (enterSection) enterSection.style.display = 'block';
  }

  static showToast(message, type = 'success', duration = CONFIG.UI.TOAST_DURATION) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 1rem;">
        <span>${message}</span>
        <button onclick="this.parentElement.parentElement.remove()" 
                style="background: none; border: none; cursor: pointer; color: var(--text-secondary);">×</button>
      </div>
    `;
    container.appendChild(toast);

    // Show toast
    setTimeout(() => toast.classList.add('show'), 100);

    // Auto-remove toast
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  static handleError(error, context = '') {
    console.error(`Error in ${context}:`, error);
    const message = error.message || 'An unexpected error occurred';
    this.showToast(`${context ? context + ': ' : ''}${message}`, 'error');
    return false;
  }

  static updateElementText(selector, text) {
    const element = document.querySelector(selector);
    if (element) {
      element.textContent = text;
    }
  }

  static updateElementHTML(selector, html) {
    const element = document.querySelector(selector);
    if (element) {
      element.innerHTML = html;
    }
  }

  static toggleElementVisibility(selector, show = null) {
    const element = document.querySelector(selector);
    if (element) {
      if (show === null) {
        element.style.display = element.style.display === 'none' ? 'block' : 'none';
      } else {
        element.style.display = show ? 'block' : 'none';
      }
    }
  }

  static addActiveClass(selector, activeSelector) {
    // Remove active class from all elements
    document.querySelectorAll(selector).forEach(el => el.classList.remove('active'));
    // Add active class to specific element
    const element = document.querySelector(activeSelector);
    if (element) {
      element.classList.add('active');
    }
  }

  static createModal(title, content, buttons = []) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3>${title}</h3>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-content">${content}</div>
        <div class="modal-footer">
          ${buttons.map(btn => `<button class="btn ${btn.class || ''}" onclick="${btn.action || ''}">${btn.text}</button>`).join('')}
        </div>
      </div>
    `;

    // Add close functionality
    modal.querySelector('.modal-close').onclick = () => modal.remove();
    modal.onclick = (e) => {
      if (e.target === modal) modal.remove();
    };

    document.body.appendChild(modal);
    return modal;
  }

  static removeModal(modal) {
    if (modal && modal.parentNode) {
      modal.parentNode.removeChild(modal);
    }
  }
}