// Input validation utilities

export class Validators {
  static sheetId(sheetId) {
    if (!sheetId || typeof sheetId !== 'string') {
      throw new Error('Sheet ID is required');
    }
    
    const trimmed = sheetId.trim();
    if (trimmed.length < 20) {
      throw new Error('Invalid Sheet ID format');
    }
    
    return trimmed;
  }

  static email(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  static amount(amount) {
    const num = parseFloat(amount);
    return !isNaN(num) && isFinite(num);
  }

  static date(dateString) {
    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date);
  }

  static url(urlString) {
    try {
      new URL(urlString);
      return true;
    } catch {
      return false;
    }
  }

  static required(value) {
    return value !== null && value !== undefined && value.toString().trim() !== '';
  }

  static length(value, min = 0, max = Infinity) {
    const length = value ? value.toString().length : 0;
    return length >= min && length <= max;
  }

  static category(category, validCategories) {
    return validCategories.includes(category);
  }

  static merchant(merchantName) {
    return typeof merchantName === 'string' && merchantName.trim().length > 0;
  }
}