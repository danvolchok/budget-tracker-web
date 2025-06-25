// Formatting utilities for dates, currency, etc.

export class Formatters {
  static currency(amount, options = {}) {
    const defaults = {
      style: 'currency',
      currency: 'CAD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    };

    return new Intl.NumberFormat('en-US', { ...defaults, ...options }).format(amount);
  }

  static number(value, options = {}) {
    return new Intl.NumberFormat('en-US', options).format(value);
  }

  static date(date, format = 'short') {
    const dateObj = date instanceof Date ? date : new Date(date);
    
    const formats = {
      short: { month: 'short', day: 'numeric', year: 'numeric' },
      long: { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' },
      monthYear: { month: 'short', year: 'numeric' },
      weekday: { weekday: 'short', month: 'short', day: 'numeric' },
      dayMonth: { month: 'short', day: 'numeric' }
    };

    return dateObj.toLocaleDateString('en-US', formats[format] || formats.short);
  }

  static percentage(value, total, decimals = 1) {
    if (total === 0) return '0%';
    return ((value / total) * 100).toFixed(decimals) + '%';
  }

  static sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    return input.trim().replace(/[<>"']/g, '');
  }

  static capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  static truncate(text, maxLength = 50) {
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  }
}